import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type GeneratedReaderScalarTypeV0 = "bool" | "f32" | "f64" | "u32" | "u64";
type EnumStorageType = "u8";

type FixedScalarShape = {
  readonly kind: "FixedScalar";
  readonly type: GeneratedReaderScalarTypeV0;
};

type FixedEnumShape = {
  readonly kind: "FixedEnum";
  readonly storage: EnumStorageType;
  readonly variants: readonly string[];
};

type FixedStringEncodedShape = {
  readonly kind: "FixedStringEncoded";
  readonly byteLength: number;
  readonly encoding: "ascii";
};

type FixedVectorShape = {
  readonly kind: "FixedVector";
  readonly elementType: GeneratedReaderScalarTypeV0;
  readonly length: number;
};

type BoundedArrayShape = {
  readonly kind: "BoundedArray";
  readonly elementType: GeneratedReaderScalarTypeV0;
  readonly maxLength: number;
};

type SupportedFieldShape =
  | FixedScalarShape
  | FixedEnumShape
  | FixedStringEncodedShape
  | FixedVectorShape
  | BoundedArrayShape;

type HotFieldEntry = {
  readonly dotPath: string;
  readonly absoluteOffset: number;
  readonly byteSpan: number;
  readonly shape: SupportedFieldShape;
};

type HotReservationEntry = {
  readonly dotPath: string;
  readonly countFieldOffset: number;
  readonly elementsOffset: number;
  readonly maxCount: number;
  readonly unitByteLength: number;
};

type HotLayoutManifest = {
  readonly seqlockOffset: number;
  readonly totalRegionByteLength: number;
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotReservationEntry[];
};

type WriteGeneratedHotReaderInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

type GeneratedField = {
  readonly name: string;
  readonly symbol: string;
  readonly offsetConstant: string;
  readonly typeSource: string;
  readonly readSource: string;
  readonly constants: readonly GeneratedConstant[];
  readonly helpers: readonly GeneratedHelper[];
};

type GeneratedConstant = {
  readonly name: string;
  readonly source: string;
};

type GeneratedHelper = {
  readonly key: string;
  readonly source: string;
};

export async function writeGeneratedHotReader({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotReaderInput): Promise<void> {
  const manifest = await readHotLayoutManifest(manifestPath);
  validateHotLayoutManifest(manifest, manifestPath);
  const source = renderHotReader({
    fixtureName,
    symbolStem,
    generatedFromPath,
    manifest,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source);
}

async function readHotLayoutManifest(path: string): Promise<HotLayoutManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain an object manifest`);
  }

  const seqlockOffset = parsed.seqlockOffset;
  const totalRegionByteLength = parsed.totalRegionByteLength;
  const fields = parsed.fields;
  const reservations = parsed.reservations;

  if (
    typeof seqlockOffset !== "number" ||
    typeof totalRegionByteLength !== "number" ||
    !Array.isArray(fields) ||
    !Array.isArray(reservations)
  ) {
    throw new Error(`${path} is not a supported hot layout manifest`);
  }

  return {
    seqlockOffset,
    totalRegionByteLength,
    fields: fields.map((field, index) => readHotField(field, path, index)),
    reservations: reservations.map((reservation, index) =>
      readHotReservation(reservation, path, index),
    ),
  };
}

function readHotField(value: unknown, path: string, index: number): HotFieldEntry {
  if (!isRecord(value)) {
    throw new Error(`${path}.fields.${index} must be an object`);
  }

  const dotPath = value.dotPath;
  const absoluteOffset = value.absoluteOffset;
  const byteSpan = value.byteSpan;
  const shape = value.shape;

  if (!isFieldName(dotPath)) {
    throw new Error(`${path}.fields.${index}.dotPath is not supported by this proof generator`);
  }

  if (typeof absoluteOffset !== "number" || typeof byteSpan !== "number") {
    throw new Error(`${path}.fields.${index} is missing required layout data`);
  }

  return {
    dotPath,
    absoluteOffset,
    byteSpan,
    shape: readSupportedShape(shape, `${path}.fields.${index}.shape`),
  };
}

function readHotReservation(value: unknown, path: string, index: number): HotReservationEntry {
  if (!isRecord(value)) {
    throw new Error(`${path}.reservations.${index} must be an object`);
  }

  const dotPath = value.dotPath;
  const countFieldOffset = value.countFieldOffset;
  const elementsOffset = value.elementsOffset;
  const maxCount = value.maxCount;
  const unitByteLength = value.unitByteLength;

  if (
    !isFieldName(dotPath) ||
    typeof countFieldOffset !== "number" ||
    typeof elementsOffset !== "number" ||
    typeof maxCount !== "number" ||
    typeof unitByteLength !== "number"
  ) {
    throw new Error(`${path}.reservations.${index} is not a supported reservation`);
  }

  return {
    dotPath,
    countFieldOffset,
    elementsOffset,
    maxCount,
    unitByteLength,
  };
}

function readSupportedShape(value: unknown, path: string): SupportedFieldShape {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  switch (value.kind) {
    case "FixedScalar":
      if (!isGeneratedReaderScalarTypeV0(value.type)) {
        throw new Error(`${path}.type is not supported by this proof generator`);
      }
      return { kind: "FixedScalar", type: value.type };

    case "FixedEnum":
      if (
        value.storage !== "u8" ||
        !Array.isArray(value.variants) ||
        !value.variants.every((variant) => typeof variant === "string")
      ) {
        throw new Error(`${path} is not a supported fixed enum shape`);
      }
      return { kind: "FixedEnum", storage: value.storage, variants: value.variants };

    case "FixedStringEncoded":
      if (typeof value.byteLength !== "number" || value.encoding !== "ascii") {
        throw new Error(`${path} is not a supported fixed string shape`);
      }
      return {
        kind: "FixedStringEncoded",
        byteLength: value.byteLength,
        encoding: value.encoding,
      };

    case "FixedVector":
      if (!isGeneratedReaderScalarTypeV0(value.elementType) || typeof value.length !== "number") {
        throw new Error(`${path} is not a supported fixed vector shape`);
      }
      return {
        kind: "FixedVector",
        elementType: value.elementType,
        length: value.length,
      };

    case "BoundedArray":
      if (
        !isGeneratedReaderScalarTypeV0(value.elementType) ||
        typeof value.maxLength !== "number"
      ) {
        throw new Error(`${path} is not a supported bounded array shape`);
      }
      return {
        kind: "BoundedArray",
        elementType: value.elementType,
        maxLength: value.maxLength,
      };

    default:
      throw new Error(`${path} is not supported by this proof generator`);
  }
}

function validateHotLayoutManifest(manifest: HotLayoutManifest, path: string): void {
  requireSafePositiveInteger(manifest.totalRegionByteLength, `${path}.totalRegionByteLength`);
  requireSafeNonNegativeInteger(manifest.seqlockOffset, `${path}.seqlockOffset`);

  const fieldNames = new Set<string>();
  const boundedArrayNames = new Set<string>();
  const generatedPropertyNames = new Set<string>();
  const generatedConstantNames = new Set<string>([
    "SEQLOCK_OFFSET",
    "TOTAL_REGION_BYTE_LENGTH",
    "U64_BYTE_ALIGNMENT",
  ]);

  for (const [index, field] of manifest.fields.entries()) {
    const fieldPath = `${path}.fields.${index}`;
    requireSafeNonNegativeInteger(field.absoluteOffset, `${fieldPath}.absoluteOffset`);
    requireSafeNonNegativeInteger(field.byteSpan, `${fieldPath}.byteSpan`);
    requireRangeEnd(
      field.absoluteOffset,
      field.byteSpan,
      manifest.totalRegionByteLength,
      fieldPath,
    );

    if (fieldNames.has(field.dotPath)) {
      throw new Error(`${fieldPath}.dotPath duplicates ${field.dotPath}`);
    }
    fieldNames.add(field.dotPath);

    if (!isSafeGeneratedPropertyName(field.dotPath)) {
      throw new Error(`${fieldPath}.dotPath is not a safe generated TS property name`);
    }
    if (generatedPropertyNames.has(field.dotPath)) {
      throw new Error(`${fieldPath}.dotPath duplicates generated TS property ${field.dotPath}`);
    }
    generatedPropertyNames.add(field.dotPath);

    validateFieldShape(field, fieldPath);

    for (const constantName of generatedConstantNamesFor(field)) {
      if (generatedConstantNames.has(constantName)) {
        throw new Error(`${fieldPath} generates duplicate constant ${constantName}`);
      }
      generatedConstantNames.add(constantName);
    }

    if (field.shape.kind === "BoundedArray") {
      boundedArrayNames.add(field.dotPath);
    }
  }

  for (const [index, reservation] of manifest.reservations.entries()) {
    const reservationPath = `${path}.reservations.${index}`;
    validateReservation(reservation, manifest.totalRegionByteLength, reservationPath);

    if (!boundedArrayNames.has(reservation.dotPath)) {
      throw new Error(`${reservationPath}.dotPath does not belong to a BoundedArray field`);
    }
  }

  for (const boundedArrayName of boundedArrayNames) {
    const count = manifest.reservations.filter(
      (reservation) => reservation.dotPath === boundedArrayName,
    ).length;
    if (count !== 1) {
      throw new Error(
        `${path}.reservations must contain exactly one ${boundedArrayName} reservation`,
      );
    }
  }
}

function validateFieldShape(field: HotFieldEntry, path: string): void {
  switch (field.shape.kind) {
    case "FixedScalar":
      requireByteSpan(field, scalarByteWidth(field.shape.type));
      return;

    case "FixedEnum":
      requireByteSpan(field, 1);
      if (field.shape.variants.length === 0) {
        throw new Error(`${path}.shape.variants must not be empty`);
      }
      return;

    case "FixedStringEncoded":
      requireSafePositiveInteger(field.shape.byteLength, `${path}.shape.byteLength`);
      requireByteSpan(field, field.shape.byteLength);
      return;

    case "FixedVector":
      requireSafePositiveInteger(field.shape.length, `${path}.shape.length`);
      requireByteSpan(field, field.shape.length * scalarByteWidth(field.shape.elementType));
      return;

    case "BoundedArray":
      requireSafePositiveInteger(field.shape.maxLength, `${path}.shape.maxLength`);
      return;

    default:
      assertNever(field.shape, `${path}.shape is not supported`);
  }
}

function validateReservation(
  reservation: HotReservationEntry,
  totalRegionByteLength: number,
  path: string,
): void {
  requireSafeNonNegativeInteger(reservation.countFieldOffset, `${path}.countFieldOffset`);
  requireSafeNonNegativeInteger(reservation.elementsOffset, `${path}.elementsOffset`);
  requireSafeNonNegativeInteger(reservation.maxCount, `${path}.maxCount`);
  requireSafePositiveInteger(reservation.unitByteLength, `${path}.unitByteLength`);
  requireRangeEnd(reservation.countFieldOffset, 4, totalRegionByteLength, path);

  const byteSpan = reservation.maxCount * reservation.unitByteLength;
  if (!Number.isSafeInteger(byteSpan)) {
    throw new Error(`${path} reservation element byte span must be a safe integer`);
  }
  requireRangeEnd(reservation.elementsOffset, byteSpan, totalRegionByteLength, path);
}

function generatedConstantNamesFor(field: HotFieldEntry): readonly string[] {
  const constantStem = toConstantStem(field.dotPath);
  const offsetConstant = `${constantStem}_OFFSET`;

  switch (field.shape.kind) {
    case "FixedScalar":
      return [offsetConstant];

    case "FixedEnum":
      return [offsetConstant, `${constantStem}_VARIANTS`];

    case "FixedStringEncoded":
      return [offsetConstant, `${constantStem}_BYTE_LENGTH`];

    case "FixedVector":
      return [
        offsetConstant,
        ...Array.from(
          { length: field.shape.length },
          (_, index) => `${constantStem}_${index}_OFFSET`,
        ),
      ];

    case "BoundedArray":
      return [
        `${constantStem}_COUNT_OFFSET`,
        `${constantStem}_ELEMENTS_OFFSET`,
        `${constantStem}_MAX_COUNT`,
        `${constantStem}_UNIT_BYTE_LENGTH`,
      ];

    default:
      return assertNever(field.shape, "field shape is not supported");
  }
}

function renderHotReader(input: {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly generatedFromPath: string;
  readonly manifest: HotLayoutManifest;
}): string {
  const fields = input.manifest.fields.map((field) => generateField(input.manifest, field));
  const snapshotTypeName = `${input.symbolStem}Snapshot`;
  const readerTypeName = `${input.symbolStem}Reader`;
  const readFunctionName = `read${input.symbolStem}SnapshotUnchecked`;
  const createFunctionName = `create${input.symbolStem}Reader`;
  const validateFunctionName = `validate${input.symbolStem}Region`;
  const objectLines = fields.map((field) => `    ${field.name}: ${field.readSource},`);
  const constants = collectGeneratedConstants(fields);
  const helpers = collectGeneratedHelpers(fields);

  return `// Generated from ${input.generatedFromPath}. Do not edit by hand.

import {
  createHotReadState,
  type HotReadAttemptResult,
  type HotReadOptions,
  type HotReadState,
  tryReadHotSnapshot,
} from "@exclave/hot-consumer";

export type ${snapshotTypeName} = {
${fields.map((field) => `  readonly ${field.name}: ${field.typeSource};`).join("\n")}
};

export type ${readerTypeName} = {
  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<${snapshotTypeName}>;
};

const SEQLOCK_OFFSET = ${input.manifest.seqlockOffset};
const TOTAL_REGION_BYTE_LENGTH = ${input.manifest.totalRegionByteLength};
${constants.map((constant) => constant.source).join("\n")}
const U64_BYTE_ALIGNMENT = BigUint64Array.BYTES_PER_ELEMENT;

export function ${readFunctionName}(region: Uint8Array): ${snapshotTypeName} {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  return read${input.symbolStem}Fields(view);
}

export function ${createFunctionName}(region: Uint8Array): ${readerTypeName} {
  ${validateFunctionName}(region);

  const sequence = new BigUint64Array(region.buffer, region.byteOffset + SEQLOCK_OFFSET, 1);
  const state: HotReadState<${snapshotTypeName}> = createHotReadState<${snapshotTypeName}>();

  return {
    tryRead: (options?: HotReadOptions) =>
      tryReadHotSnapshot({
        sequence,
        readCandidate: () => ${readFunctionName}(region),
        state,
        options,
      }),
  };
}

function read${input.symbolStem}Fields(view: DataView): ${snapshotTypeName} {
  return {
${objectLines.join("\n")}
  };
}
${helpers.length > 0 ? `\n${helpers.map((helper) => helper.source).join("\n\n")}\n` : ""}
function ${validateFunctionName}(region: Uint8Array): void {
  if (!(region instanceof Uint8Array)) {
    throw new TypeError("${input.fixtureName} region must be a Uint8Array");
  }

  if (!(region.buffer instanceof SharedArrayBuffer)) {
    throw new TypeError("${input.fixtureName} region must be backed by SharedArrayBuffer");
  }

  if (region.byteLength < TOTAL_REGION_BYTE_LENGTH) {
    throw new RangeError(\`${input.fixtureName} region must be at least \${TOTAL_REGION_BYTE_LENGTH} bytes\`);
  }

  const absoluteSeqlockOffset = region.byteOffset + SEQLOCK_OFFSET;
  if (absoluteSeqlockOffset % U64_BYTE_ALIGNMENT !== 0) {
    throw new RangeError("${input.fixtureName} seqlock view is not u64-aligned");
  }
}
`;
}

function generateField(manifest: HotLayoutManifest, field: HotFieldEntry): GeneratedField {
  const symbol = toPascalCase(field.dotPath);
  const offsetConstant = `${toConstantStem(field.dotPath)}_OFFSET`;
  const base = {
    name: field.dotPath,
    symbol,
    offsetConstant,
  };

  switch (field.shape.kind) {
    case "FixedScalar":
      requireByteSpan(field, scalarByteWidth(field.shape.type));
      return {
        ...base,
        typeSource: scalarTypeSource(field.shape.type),
        readSource: scalarReadSource(field.shape.type, offsetConstant, field.dotPath),
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
        ],
        helpers: scalarHelpers(field.shape.type),
      };

    case "FixedEnum":
      requireByteSpan(field, 1);
      return {
        ...base,
        typeSource: field.shape.variants.map((variant) => JSON.stringify(variant)).join(" | "),
        readSource: `read${symbol}(view)`,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          {
            name: `${toConstantStem(field.dotPath)}_VARIANTS`,
            source: `const ${toConstantStem(field.dotPath)}_VARIANTS = [${field.shape.variants.map((variant) => JSON.stringify(variant)).join(", ")}] as const;`,
          },
        ],
        helpers: [
          {
            key: `read${symbol}`,
            source: `function read${symbol}(view: DataView): ${field.shape.variants.map((variant) => JSON.stringify(variant)).join(" | ")} {
  const discriminant = view.getUint8(${offsetConstant});
  const value = ${toConstantStem(field.dotPath)}_VARIANTS[discriminant];
  if (value === undefined) {
    throw new RangeError("${field.dotPath} enum discriminant is outside variants");
  }
  return value;
}`,
          },
        ],
      };

    case "FixedStringEncoded":
      requireByteSpan(field, field.shape.byteLength);
      return {
        ...base,
        typeSource: "string",
        readSource: `read${symbol}(view)`,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          {
            name: `${toConstantStem(field.dotPath)}_BYTE_LENGTH`,
            source: `const ${toConstantStem(field.dotPath)}_BYTE_LENGTH = ${field.shape.byteLength};`,
          },
        ],
        helpers: [
          {
            key: `read${symbol}`,
            source: `function read${symbol}(view: DataView): string {
  let value = "";
  for (
    let offset = ${offsetConstant};
    offset < ${offsetConstant} + ${toConstantStem(field.dotPath)}_BYTE_LENGTH;
    offset += 1
  ) {
    const byte = view.getUint8(offset);
    if (byte === 0) {
      break;
    }
    if (byte > 0x7f) {
      throw new RangeError("${field.dotPath} contains a non-ascii byte");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}`,
          },
        ],
      };

    case "FixedVector": {
      const shape = field.shape;
      const unitByteLength = scalarByteWidth(shape.elementType);
      requireByteSpan(field, shape.length * unitByteLength);
      const constantStem = toConstantStem(field.dotPath);
      const elementConstants = Array.from({ length: shape.length }, (_, index) => {
        const name = `${constantStem}_${index}_OFFSET`;
        return {
          name,
          source:
            index === 0
              ? `const ${name} = ${offsetConstant};`
              : `const ${name} = ${field.absoluteOffset + index * unitByteLength};`,
        };
      });
      return {
        ...base,
        typeSource: `readonly [${Array.from({ length: shape.length }, () => scalarTypeSource(shape.elementType)).join(", ")}]`,
        readSource: `[
      ${Array.from({ length: shape.length }, (_, index) =>
        scalarReadSource(shape.elementType, `${constantStem}_${index}_OFFSET`, field.dotPath),
      ).join(",\n      ")},
    ]`,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          ...elementConstants,
        ],
        helpers: scalarHelpers(shape.elementType),
      };
    }

    case "BoundedArray": {
      const shape = field.shape;
      const reservation = reservationFor(manifest, field);
      const unitByteLength = scalarByteWidth(shape.elementType);
      if (reservation.maxCount !== shape.maxLength) {
        throw new Error(`${field.dotPath} reservation maxCount does not match maxLength`);
      }
      if (reservation.unitByteLength !== unitByteLength) {
        throw new Error(`${field.dotPath} reservation unitByteLength does not match element type`);
      }
      return {
        ...base,
        typeSource: `readonly ${scalarTypeSource(shape.elementType)}[]`,
        readSource: `read${symbol}(view)`,
        constants: [
          {
            name: `${toConstantStem(field.dotPath)}_COUNT_OFFSET`,
            source: `const ${toConstantStem(field.dotPath)}_COUNT_OFFSET = ${reservation.countFieldOffset};`,
          },
          {
            name: `${toConstantStem(field.dotPath)}_ELEMENTS_OFFSET`,
            source: `const ${toConstantStem(field.dotPath)}_ELEMENTS_OFFSET = ${reservation.elementsOffset};`,
          },
          {
            name: `${toConstantStem(field.dotPath)}_MAX_COUNT`,
            source: `const ${toConstantStem(field.dotPath)}_MAX_COUNT = ${reservation.maxCount};`,
          },
          {
            name: `${toConstantStem(field.dotPath)}_UNIT_BYTE_LENGTH`,
            source: `const ${toConstantStem(field.dotPath)}_UNIT_BYTE_LENGTH = ${reservation.unitByteLength};`,
          },
        ],
        helpers: [
          {
            key: `read${symbol}`,
            source: `function read${symbol}(view: DataView): readonly ${scalarTypeSource(shape.elementType)}[] {
  const count = view.getUint32(${toConstantStem(field.dotPath)}_COUNT_OFFSET, true);
  if (count > ${toConstantStem(field.dotPath)}_MAX_COUNT) {
    throw new RangeError("${field.dotPath} bounded array count exceeds maxCount");
  }

  const values: ${scalarTypeSource(shape.elementType)}[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(${scalarReadSource(
      shape.elementType,
      `${toConstantStem(field.dotPath)}_ELEMENTS_OFFSET + index * ${toConstantStem(field.dotPath)}_UNIT_BYTE_LENGTH`,
      field.dotPath,
    )});
  }
  return values;
}`,
          },
          ...scalarHelpers(shape.elementType),
        ],
      };
    }

    default:
      return assertNever(field.shape, `${field.dotPath} shape is not supported`);
  }
}

function collectGeneratedConstants(
  fields: readonly GeneratedField[],
): readonly GeneratedConstant[] {
  const constants: GeneratedConstant[] = [];
  const names = new Set<string>();

  for (const field of fields) {
    for (const constant of field.constants) {
      if (names.has(constant.name)) {
        throw new Error(`generated reader constant ${constant.name} is duplicated`);
      }
      names.add(constant.name);
      constants.push(constant);
    }
  }

  return constants;
}

function collectGeneratedHelpers(fields: readonly GeneratedField[]): readonly GeneratedHelper[] {
  const helpers = new Map<string, GeneratedHelper>();

  for (const field of fields) {
    for (const helper of field.helpers) {
      const existing = helpers.get(helper.key);
      if (existing !== undefined) {
        if (existing.source !== helper.source) {
          throw new Error(`generated reader helper ${helper.key} has conflicting sources`);
        }
        continue;
      }

      helpers.set(helper.key, helper);
    }
  }

  return [...helpers.values()];
}

function scalarReadSource(
  type: GeneratedReaderScalarTypeV0,
  offsetSource: string,
  fieldName: string,
): string {
  switch (type) {
    case "bool":
      return `readBoolean(view, ${offsetSource}, ${JSON.stringify(fieldName)})`;
    case "f32":
      return `view.getFloat32(${offsetSource}, true)`;
    case "f64":
      return `view.getFloat64(${offsetSource}, true)`;
    case "u32":
      return `view.getUint32(${offsetSource}, true)`;
    case "u64":
      return `view.getBigUint64(${offsetSource}, true)`;
    default:
      return assertNever(type, "generated reader scalar type is not supported");
  }
}

function scalarHelpers(type: GeneratedReaderScalarTypeV0): readonly GeneratedHelper[] {
  switch (type) {
    case "bool":
      return [
        {
          key: "readBoolean",
          source: `function readBoolean(view: DataView, offset: number, fieldName: string): boolean {
  const value = view.getUint8(offset);
  if (value === 0) {
    return false;
  }
  if (value === 1) {
    return true;
  }
  throw new RangeError(\`\${fieldName} bool byte must be 0 or 1\`);
}`,
        },
      ];

    case "f32":
    case "f64":
    case "u32":
    case "u64":
      return [];

    default:
      return assertNever(type, "generated reader scalar type is not supported");
  }
}

function scalarTypeSource(type: GeneratedReaderScalarTypeV0): string {
  switch (type) {
    case "bool":
      return "boolean";
    case "f32":
    case "f64":
    case "u32":
      return "number";
    case "u64":
      return "bigint";
    default:
      return assertNever(type, "generated reader scalar type is not supported");
  }
}

function scalarByteWidth(type: GeneratedReaderScalarTypeV0): number {
  switch (type) {
    case "bool":
      return 1;
    case "f32":
    case "u32":
      return 4;
    case "f64":
    case "u64":
      return 8;
    default:
      return assertNever(type, "generated reader scalar type is not supported");
  }
}

function reservationFor(manifest: HotLayoutManifest, field: HotFieldEntry): HotReservationEntry {
  const matches = manifest.reservations.filter(
    (reservation) => reservation.dotPath === field.dotPath,
  );

  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`${field.dotPath} must have exactly one reservation`);
  }

  return matches[0];
}

function requireByteSpan(field: HotFieldEntry, expected: number): void {
  if (field.byteSpan !== expected) {
    throw new Error(`${field.dotPath} byteSpan must be ${expected}`);
  }
}

function requireSafePositiveInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${path} must be a safe positive integer`);
  }
}

function requireSafeNonNegativeInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a safe non-negative integer`);
  }
}

function requireRangeEnd(
  offset: number,
  byteSpan: number,
  totalRegionByteLength: number,
  path: string,
): void {
  const end = offset + byteSpan;
  if (!Number.isSafeInteger(end) || end > totalRegionByteLength) {
    throw new Error(`${path} byte range exceeds totalRegionByteLength`);
  }
}

function isGeneratedReaderScalarTypeV0(value: unknown): value is GeneratedReaderScalarTypeV0 {
  return (
    value === "bool" || value === "f32" || value === "f64" || value === "u32" || value === "u64"
  );
}

function isFieldName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-zA-Z0-9]*$/.test(value);
}

function isSafeGeneratedPropertyName(value: string): boolean {
  return isFieldName(value) && !typescriptReservedWords.has(value);
}

function toPascalCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function toConstantStem(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

const typescriptReservedWords = new Set([
  "any",
  "as",
  "async",
  "await",
  "bigint",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
