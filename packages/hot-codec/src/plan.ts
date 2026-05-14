import {
  HOT_ABI_VERSION,
  HOT_BASELINE_EPOCH_U32_OFFSET,
  HOT_BLOCK_A_BYTE_LENGTH,
  HOT_BLOCK_B_BYTE_OFFSET,
  HOT_CONTINUITY_GENERATION_U32_OFFSET,
  HOT_FIELD_DATA_BYTE_OFFSET,
  HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
  HOT_SEQLOCK_U64_OFFSET,
} from "./constants";
import { HotCodecError, type HotCodecIssue } from "./error";
import type {
  HotFieldEntry,
  HotLayoutManifest,
  HotLayoutPlanFailure,
  HotLayoutPlanningField,
  HotLayoutPlanningInput,
  HotLayoutPlanResult,
  HotLayoutPlanSuccess,
  HotReservationEntry,
} from "./manifest";
import {
  cloneShape,
  collectShapeIssues,
  compareUtf8,
  fieldByteSpan,
  isBoundedShape,
  isRecord,
  isVariableShape,
  naturalAlignment,
  reservationMetrics,
  roundUp,
} from "./shape";
import { deriveHotLayoutVersion } from "./version";

const UINT32_MAX = 0xffffffff;

export function planHotLayoutManifest(input: HotLayoutPlanningInput): HotLayoutPlanResult {
  const issues = validatePlanningInput(input);
  if (issues.length > 0) {
    return failure(issues);
  }

  const layout = planLayout(input, issues);
  if (issues.length > 0) {
    return failure(issues);
  }

  const manifestWithoutVersion = {
    contractKey: input.contractKey,
    hotLayoutVersion: 0n,
    hotAbiVersion: HOT_ABI_VERSION,
    blockASize: HOT_BLOCK_A_BYTE_LENGTH,
    blockBStartOffset: HOT_BLOCK_B_BYTE_OFFSET,
    seqlockOffset: HOT_SEQLOCK_U64_OFFSET,
    baselineEpochOffset: HOT_BASELINE_EPOCH_U32_OFFSET,
    continuityGenOffset: HOT_CONTINUITY_GENERATION_U32_OFFSET,
    publicationSeqOffset: HOT_PUBLICATION_SEQUENCE_U64_OFFSET,
    fieldDataOrigin: HOT_FIELD_DATA_BYTE_OFFSET,
    totalRegionByteLength: layout.totalRegionByteLength,
    mutableRegionByteLength: layout.mutableRegionByteLength,
    fields: layout.fields,
    reservations: layout.reservations,
  } satisfies HotLayoutManifest;

  return success({
    ...manifestWithoutVersion,
    hotLayoutVersion: deriveHotLayoutVersion(manifestWithoutVersion),
  });
}

interface PlannedLayout {
  readonly totalRegionByteLength: number;
  readonly mutableRegionByteLength: number;
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotReservationEntry[];
}

function validatePlanningInput(input: HotLayoutPlanningInput): HotCodecIssue[] {
  const issues: HotCodecIssue[] = [];

  if (!isRecord(input)) {
    issues.push({
      code: "input.invalid",
      path: "",
      message: "hot layout planning input must be an object",
    });
    return issues;
  }

  if (typeof input.contractKey !== "string" || input.contractKey.length === 0) {
    issues.push({
      code: "input.contractKeyInvalid",
      path: "contractKey",
      message: "contractKey must be a non-empty string",
    });
  }

  if (!isRecord(input.hot)) {
    issues.push({
      code: "hot.invalid",
      path: "hot",
      message: "hot lane declaration must be an object",
    });
  } else {
    if (input.hot.codec !== "mapped-fixed") {
      issues.push({
        code: "hot.codecUnsupported",
        path: "hot.codec",
        message: "hot codec must be mapped-fixed",
      });
    }

    if (!Array.isArray(input.hot.reservations)) {
      issues.push({
        code: "hot.reservationsInvalid",
        path: "hot.reservations",
        message: "hot reservations must be an array",
      });
    }
  }

  if (!Array.isArray(input.fields)) {
    issues.push({
      code: "field.listInvalid",
      path: "fields",
      message: "fields must be an array",
    });
    return issues;
  }

  if (input.fields.length > UINT32_MAX) {
    issues.push({
      code: "field.countOutOfRange",
      path: "fields",
      message: "field count must fit in u32",
    });
  }

  validateFields(input.fields, issues);
  validateReservations(input, issues);
  validateHotAdmissibility(input, issues);

  return issues;
}

function validateFields(fields: readonly HotLayoutPlanningField[], issues: HotCodecIssue[]): void {
  const dotPaths = new Set<string>();
  const fieldIds = new Set<number>();

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const path = `fields.${index}`;

    if (!isRecord(field)) {
      issues.push({
        code: "field.invalid",
        path,
        message: "field entry must be an object",
      });
      continue;
    }

    if (typeof field.dotPath !== "string" || field.dotPath.length === 0) {
      issues.push({
        code: "field.dotPathInvalid",
        path: `${path}.dotPath`,
        message: "field dotPath must be a non-empty string",
      });
    } else if (dotPaths.has(field.dotPath)) {
      issues.push({
        code: "field.duplicateDotPath",
        path: `${path}.dotPath`,
        message: "field dotPath must be unique",
      });
    } else {
      dotPaths.add(field.dotPath);
    }

    if (!isU32(field.fieldId)) {
      issues.push({
        code: "field.fieldIdInvalid",
        path: `${path}.fieldId`,
        message: "fieldId must be a u32 number",
      });
    } else if (fieldIds.has(field.fieldId)) {
      issues.push({
        code: "field.duplicateFieldId",
        path: `${path}.fieldId`,
        message: "fieldId must be unique within one hot layout",
      });
    } else {
      fieldIds.add(field.fieldId);
    }

    collectShapeIssues(field.shape, `${path}.shape`, issues);

    if (index > 0) {
      const previous = fields[index - 1];
      if (
        isRecord(previous) &&
        typeof previous.dotPath === "string" &&
        typeof field.dotPath === "string" &&
        compareUtf8(previous.dotPath, field.dotPath) > 0
      ) {
        issues.push({
          code: "field.orderInvalid",
          path: `${path}.dotPath`,
          message: "fields must be sorted lexicographically by UTF-8 dotPath",
        });
      }
    }
  }
}

function validateReservations(input: HotLayoutPlanningInput, issues: HotCodecIssue[]): void {
  if (!Array.isArray(input.hot?.reservations) || !Array.isArray(input.fields)) {
    return;
  }

  const fieldByPath = new Map<string, HotLayoutPlanningField>();
  for (const field of input.fields) {
    if (isRecord(field) && typeof field.dotPath === "string") {
      fieldByPath.set(field.dotPath, field as unknown as HotLayoutPlanningField);
    }
  }
  const seenReservations = new Set<string>();

  for (let index = 0; index < input.hot.reservations.length; index += 1) {
    const reservation = input.hot.reservations[index];
    const path = `hot.reservations.${index}`;

    if (typeof reservation !== "string" || reservation.length === 0) {
      issues.push({
        code: "reservation.invalid",
        path,
        message: "hot reservation must be a non-empty dotPath string",
      });
      continue;
    }

    if (seenReservations.has(reservation)) {
      issues.push({
        code: "reservation.duplicate",
        path,
        message: "hot reservation dotPath must be unique",
      });
      continue;
    }
    seenReservations.add(reservation);

    const field = fieldByPath.get(reservation);
    if (field === undefined) {
      issues.push({
        code: "reservation.unknownField",
        path,
        message: "hot reservation names a field that does not exist",
      });
      continue;
    }

    if (isRecord(field.shape)) {
      if (field.shape.kind !== "BoundedArray" && field.shape.kind !== "BoundedMap") {
        issues.push({
          code: "reservation.wrongShape",
          path,
          message: "hot reservation must name a BoundedArray or BoundedMap field",
        });
      }
    }
  }
}

function validateHotAdmissibility(input: HotLayoutPlanningInput, issues: HotCodecIssue[]): void {
  if (!Array.isArray(input.hot?.reservations) || !Array.isArray(input.fields)) {
    return;
  }

  const reservations = new Set(input.hot.reservations);

  for (let index = 0; index < input.fields.length; index += 1) {
    const field = input.fields[index];
    if (!isRecord(field?.shape)) {
      continue;
    }

    const shape = field.shape as HotLayoutPlanningField["shape"];
    if (shape.kind === "VariableString") {
      issues.push({
        code: "shape.variableStringUnsupported",
        path: `fields.${index}.shape`,
        message: "VariableString is not hot-admissible",
      });
      continue;
    }

    if (shape.kind === "VariableMap") {
      issues.push({
        code: "shape.variableMapUnsupported",
        path: `fields.${index}.shape`,
        message: "VariableMap is not hot-admissible",
      });
      continue;
    }

    if (isBoundedShape(shape) && !reservations.has(field.dotPath)) {
      issues.push({
        code: "field.hotNotAdmissible",
        path: `fields.${index}.shape`,
        message: `${shape.kind} is hot-admissible only when its dotPath is reserved`,
      });
    }
  }
}

function planLayout(input: HotLayoutPlanningInput, issues: HotCodecIssue[]): PlannedLayout {
  let currentOffset: number = HOT_FIELD_DATA_BYTE_OFFSET;
  const reservationSet = new Set(input.hot.reservations);
  const fields: HotFieldEntry[] = [];
  const reservations: HotReservationEntry[] = [];

  for (const field of input.fields) {
    if (isVariableShape(field.shape)) {
      throw new Error("variable shapes must be rejected before planning");
    }

    const alignment = naturalAlignment(field.shape);
    currentOffset = checkedLayoutValue(
      roundUp(currentOffset, alignment),
      `fields.${field.dotPath}.absoluteOffset`,
      issues,
    );

    const absoluteOffset = currentOffset;
    const byteSpan = checkedLayoutValue(
      fieldByteSpan(field.shape),
      `fields.${field.dotPath}.byteSpan`,
      issues,
    );
    const fieldEntry: HotFieldEntry = {
      dotPath: field.dotPath,
      fieldId: field.fieldId,
      shape: cloneShape(field.shape),
      absoluteOffset,
      byteSpan,
      alignment,
    };
    fields.push(fieldEntry);

    if (isBoundedShape(field.shape) && reservationSet.has(field.dotPath)) {
      const metrics = reservationMetrics(field.shape, absoluteOffset);
      reservations.push({
        dotPath: field.dotPath,
        countFieldOffset: checkedLayoutValue(
          metrics.countFieldOffset,
          `fields.${field.dotPath}.reservation.countFieldOffset`,
          issues,
        ),
        elementsOffset: checkedLayoutValue(
          metrics.elementsOffset,
          `fields.${field.dotPath}.reservation.elementsOffset`,
          issues,
        ),
        maxCount: checkedLayoutValue(
          metrics.maxCount,
          `fields.${field.dotPath}.reservation.maxCount`,
          issues,
        ),
        unitByteLength: checkedLayoutValue(
          metrics.unitByteLength,
          `fields.${field.dotPath}.reservation.unitByteLength`,
          issues,
        ),
      });
    }

    currentOffset = checkedLayoutValue(
      currentOffset + byteSpan,
      `fields.${field.dotPath}.endOffset`,
      issues,
    );
  }

  const totalRegionByteLength = checkedLayoutValue(
    roundUp(currentOffset, 8),
    "totalRegionByteLength",
    issues,
  );
  const mutableRegionByteLength = checkedLayoutValue(
    totalRegionByteLength - HOT_BLOCK_A_BYTE_LENGTH,
    "mutableRegionByteLength",
    issues,
  );

  return {
    totalRegionByteLength,
    mutableRegionByteLength,
    fields,
    reservations,
  };
}

function checkedLayoutValue(value: number, path: string, issues: HotCodecIssue[]): number {
  if (Number.isSafeInteger(value) && value >= 0 && value <= UINT32_MAX) {
    return value;
  }

  issues.push({
    code: "layout.numericOutOfRange",
    path,
    message: "computed offset or byte length must be a safe u32 integer",
  });
  return value;
}

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

function success(value: HotLayoutManifest): HotLayoutPlanSuccess {
  return { ok: true, value };
}

function failure(issues: readonly HotCodecIssue[]): HotLayoutPlanFailure {
  return { ok: false, error: new HotCodecError(issues) };
}
