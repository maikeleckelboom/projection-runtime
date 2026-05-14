import { panic } from "@seqlok/base";

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
import { createHotCodecIssue, HotCodecError, type HotCodecIssue } from "./error";
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
    issues.push(createHotCodecIssue("input.invalid", ""));
    return issues;
  }

  if (typeof input.contractKey !== "string" || input.contractKey.length === 0) {
    issues.push(createHotCodecIssue("input.contractKeyInvalid", "contractKey"));
  }

  if (!isRecord(input.hot)) {
    issues.push(createHotCodecIssue("hot.invalid", "hot"));
  } else {
    if (input.hot.codec !== "mapped-fixed") {
      issues.push(createHotCodecIssue("hot.codecUnsupported", "hot.codec"));
    }

    if (!Array.isArray(input.hot.reservations)) {
      issues.push(createHotCodecIssue("hot.reservationsInvalid", "hot.reservations"));
    }
  }

  if (!Array.isArray(input.fields)) {
    issues.push(createHotCodecIssue("field.listInvalid", "fields"));
    return issues;
  }

  if (input.fields.length > UINT32_MAX) {
    issues.push(createHotCodecIssue("field.countOutOfRange", "fields"));
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
      issues.push(createHotCodecIssue("field.invalid", path));
      continue;
    }

    if (typeof field.dotPath !== "string" || field.dotPath.length === 0) {
      issues.push(createHotCodecIssue("field.dotPathInvalid", `${path}.dotPath`));
    } else if (dotPaths.has(field.dotPath)) {
      issues.push(createHotCodecIssue("field.duplicateDotPath", `${path}.dotPath`));
    } else {
      dotPaths.add(field.dotPath);
    }

    if (!isU32(field.fieldId)) {
      issues.push(createHotCodecIssue("field.fieldIdInvalid", `${path}.fieldId`));
    } else if (fieldIds.has(field.fieldId)) {
      issues.push(createHotCodecIssue("field.duplicateFieldId", `${path}.fieldId`));
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
        issues.push(createHotCodecIssue("field.orderInvalid", `${path}.dotPath`));
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
      issues.push(createHotCodecIssue("reservation.invalid", path));
      continue;
    }

    if (seenReservations.has(reservation)) {
      issues.push(createHotCodecIssue("reservation.duplicate", path));
      continue;
    }
    seenReservations.add(reservation);

    const field = fieldByPath.get(reservation);
    if (field === undefined) {
      issues.push(createHotCodecIssue("reservation.unknownField", path));
      continue;
    }

    if (isRecord(field.shape)) {
      if (field.shape.kind !== "BoundedArray" && field.shape.kind !== "BoundedMap") {
        issues.push(createHotCodecIssue("reservation.wrongShape", path));
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
      issues.push(createHotCodecIssue("shape.variableStringUnsupported", `fields.${index}.shape`));
      continue;
    }

    if (shape.kind === "VariableMap") {
      issues.push(createHotCodecIssue("shape.variableMapUnsupported", `fields.${index}.shape`));
      continue;
    }

    if (isBoundedShape(shape) && !reservations.has(field.dotPath)) {
      issues.push(
        createHotCodecIssue(
          "field.hotNotAdmissible",
          `fields.${index}.shape`,
          `${shape.kind} is hot-admissible only when its dotPath is reserved`,
        ),
      );
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
      panic("variable shapes must be rejected before planning");
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

  issues.push(createHotCodecIssue("layout.numericOutOfRange", path));
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
