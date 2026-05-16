import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type GeneratedWriterScalarTypeV0 = "bool" | "f32" | "f64" | "u32" | "u64";
type EnumStorageType = "u8";

type FixedScalarShape = {
  readonly kind: "FixedScalar";
  readonly type: GeneratedWriterScalarTypeV0;
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
  readonly elementType: GeneratedWriterScalarTypeV0;
  readonly length: number;
};

type BoundedArrayShape = {
  readonly kind: "BoundedArray";
  readonly elementType: GeneratedWriterScalarTypeV0;
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
  readonly publicationSeqOffset: number;
  readonly totalRegionByteLength: number;
  readonly fields: readonly HotFieldEntry[];
  readonly reservations: readonly HotReservationEntry[];
};

type WriteGeneratedHotWriterInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

type GeneratedField = {
  readonly name: string;
  readonly symbol: string;
  readonly constants: readonly GeneratedConstant[];
  readonly helpers: readonly GeneratedHelper[];
  readonly validationSource: readonly string[];
  readonly writeSource: readonly string[];
};

type GeneratedConstant = {
  readonly name: string;
  readonly source: string;
};

type GeneratedHelper = {
  readonly key: string;
  readonly source: string;
};

export async function writeGeneratedHotWriter({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotWriterInput): Promise<void> {
  validateGeneratedWriterProfile({ fixtureName, symbolStem, generatedFromPath });

  const manifest = await readHotLayoutManifest(manifestPath);
  validateHotLayoutManifest(manifest, manifestPath);

  const source = renderHotWriter({
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
  const publicationSeqOffset = parsed.publicationSeqOffset;
  const totalRegionByteLength = parsed.totalRegionByteLength;
  const fields = parsed.fields;
  const reservations = parsed.reservations;

  if (
    typeof seqlockOffset !== "number" ||
    typeof publicationSeqOffset !== "number" ||
    typeof totalRegionByteLength !== "number" ||
    !Array.isArray(fields) ||
    !Array.isArray(reservations)
  ) {
    throw new Error(`${path} is not a supported hot layout manifest`);
  }

  return {
    seqlockOffset,
    publicationSeqOffset,
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
    throw new Error(`${path}.fields.${index}.dotPath is not supported by generated writer v0`);
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
      if (!isGeneratedWriterScalarTypeV0(value.type)) {
        throw new Error(`${path}.type is not supported by generated writer v0`);
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
      if (!isGeneratedWriterScalarTypeV0(value.elementType) || typeof value.length !== "number") {
        throw new Error(`${path} is not a supported fixed vector shape`);
      }
      return {
        kind: "FixedVector",
        elementType: value.elementType,
        length: value.length,
      };

    case "BoundedArray":
      if (
        !isGeneratedWriterScalarTypeV0(value.elementType) ||
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
      throw new Error(`${path} is not supported by generated writer v0`);
  }
}

function validateGeneratedWriterProfile({
  fixtureName,
  symbolStem,
  generatedFromPath,
}: {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly generatedFromPath: string;
}): void {
  if (!isSafeFixtureName(fixtureName)) {
    throw new Error(`${fixtureName} is not a safe generated writer fixture name`);
  }

  if (!isSafeSymbolStem(symbolStem)) {
    throw new Error(`${fixtureName} symbolStem is not a safe generated TS symbol stem`);
  }

  if (generatedFromPath.includes("\n") || generatedFromPath.includes("\r")) {
    throw new Error(`${fixtureName} generatedFromPath must fit on one generated comment line`);
  }
}

function validateHotLayoutManifest(manifest: HotLayoutManifest, path: string): void {
  requireSafePositiveInteger(manifest.totalRegionByteLength, `${path}.totalRegionByteLength`);
  requireSafeNonNegativeInteger(manifest.seqlockOffset, `${path}.seqlockOffset`);
  requireSafeNonNegativeInteger(manifest.publicationSeqOffset, `${path}.publicationSeqOffset`);
  requireRangeEnd(
    manifest.seqlockOffset,
    8,
    manifest.totalRegionByteLength,
    `${path}.seqlockOffset`,
  );
  requireRangeEnd(
    manifest.publicationSeqOffset,
    8,
    manifest.totalRegionByteLength,
    `${path}.publicationSeqOffset`,
  );

  const fieldNames = new Set<string>();
  const boundedArrayFields = new Map<string, HotFieldEntry>();
  const generatedPropertyNames = new Set<string>();
  const generatedConstantNames = new Set<string>([
    "SEQLOCK_OFFSET",
    "PUBLICATION_SEQUENCE_OFFSET",
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
      boundedArrayFields.set(field.dotPath, field);
    }
  }

  for (const [index, reservation] of manifest.reservations.entries()) {
    const reservationPath = `${path}.reservations.${index}`;

    validateReservation(reservation, manifest.totalRegionByteLength, reservationPath);

    const field = boundedArrayFields.get(reservation.dotPath);
    if (field === undefined) {
      throw new Error(`${reservationPath}.dotPath does not belong to a BoundedArray field`);
    }

    validateBoundedArrayReservation(field, reservation, reservationPath);
  }

  for (const [dotPath, field] of boundedArrayFields) {
    const matches = manifest.reservations.filter((reservation) => reservation.dotPath === dotPath);

    if (matches.length !== 1 || matches[0] === undefined) {
      throw new Error(`${path}.reservations must contain exactly one ${dotPath} reservation`);
    }

    validateBoundedArrayReservation(field, matches[0], `${path}.reservations.${dotPath}`);
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
      if (field.shape.variants.length > 256) {
        throw new Error(`${path}.shape.variants must fit in u8 storage`);
      }
      if (new Set(field.shape.variants).size !== field.shape.variants.length) {
        throw new Error(`${path}.shape.variants must be unique`);
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
  requireSafePositiveInteger(reservation.maxCount, `${path}.maxCount`);
  requireSafePositiveInteger(reservation.unitByteLength, `${path}.unitByteLength`);
  requireRangeEnd(reservation.countFieldOffset, 4, totalRegionByteLength, path);

  const byteSpan = reservation.maxCount * reservation.unitByteLength;
  if (!Number.isSafeInteger(byteSpan)) {
    throw new Error(`${path} reservation element byte span must be a safe integer`);
  }
  requireRangeEnd(reservation.elementsOffset, byteSpan, totalRegionByteLength, path);
}

function validateBoundedArrayReservation(
  field: HotFieldEntry,
  reservation: HotReservationEntry,
  path: string,
): void {
  if (field.shape.kind !== "BoundedArray") {
    throw new Error(`${path}.dotPath does not belong to a BoundedArray field`);
  }

  const unitByteLength = scalarByteWidth(field.shape.elementType);

  if (reservation.countFieldOffset !== field.absoluteOffset) {
    throw new Error(`${path}.countFieldOffset must match ${field.dotPath} field absoluteOffset`);
  }

  if (reservation.maxCount !== field.shape.maxLength) {
    throw new Error(`${path}.maxCount must match ${field.dotPath} maxLength`);
  }

  if (reservation.unitByteLength !== unitByteLength) {
    throw new Error(`${path}.unitByteLength must match ${field.dotPath} element byte width`);
  }

  const fieldStart = field.absoluteOffset;
  const fieldEnd = field.absoluteOffset + field.byteSpan;
  const countEnd = reservation.countFieldOffset + 4;
  const elementsEnd =
    reservation.elementsOffset + reservation.maxCount * reservation.unitByteLength;

  if (
    !Number.isSafeInteger(fieldEnd) ||
    !Number.isSafeInteger(countEnd) ||
    !Number.isSafeInteger(elementsEnd)
  ) {
    throw new Error(`${path} bounded array byte windows must be safe integers`);
  }

  if (
    reservation.countFieldOffset < fieldStart ||
    countEnd > fieldEnd ||
    reservation.elementsOffset < fieldStart ||
    elementsEnd > fieldEnd
  ) {
    throw new Error(
      `${path} reservation byte window must stay inside ${field.dotPath} field window`,
    );
  }
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
        `${constantStem}_LENGTH`,
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

function renderHotWriter(input: {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly generatedFromPath: string;
  readonly manifest: HotLayoutManifest;
}): string {
  const fields = input.manifest.fields.map((field) => generateField(input.manifest, field));
  const snapshotTypeName = `${input.symbolStem}Snapshot`;
  const writerTypeName = `${input.symbolStem}Writer`;
  const createFunctionName = `create${input.symbolStem}Writer`;
  const validateSnapshotFunctionName = `validate${input.symbolStem}Snapshot`;
  const writeFunctionName = `write${input.symbolStem}SnapshotUnchecked`;
  const validateRegionFunctionName = `validate${input.symbolStem}Region`;
  const constants = collectGeneratedConstants(fields);
  const helpers = collectGeneratedHelpers(fields);

  return withFinalNewline([
    `// Generated from ${input.generatedFromPath}. Do not edit by hand.`,
    "",
    ...renderImports(snapshotTypeName),
    "",
    ...renderWriterType(writerTypeName, snapshotTypeName),
    "",
    `const SEQLOCK_OFFSET = ${input.manifest.seqlockOffset};`,
    `const PUBLICATION_SEQUENCE_OFFSET = ${input.manifest.publicationSeqOffset};`,
    `const TOTAL_REGION_BYTE_LENGTH = ${input.manifest.totalRegionByteLength};`,
    ...constants.map((constant) => constant.source),
    "const U64_BYTE_ALIGNMENT = BigUint64Array.BYTES_PER_ELEMENT;",
    "",
    ...renderCreateWriterFunction({
      createFunctionName,
      writerTypeName,
      snapshotTypeName,
      validateRegionFunctionName,
      validateSnapshotFunctionName,
      writeFunctionName,
    }),
    "",
    ...renderValidateSnapshotFunction(validateSnapshotFunctionName, snapshotTypeName, fields),
    "",
    ...renderUncheckedWriteFunction(writeFunctionName, snapshotTypeName, fields),
    "",
    ...renderHelperSources(helpers),
    ...renderValidateRegionFunction(input.fixtureName, validateRegionFunctionName),
    "",
    ...renderCommonHelpers(helpers),
  ]);
}

function renderImports(snapshotTypeName: string): readonly string[] {
  return [
    'import { type HotPublishResult, publishHotRegion } from "@exclave/hot-publisher";',
    `import type { ${snapshotTypeName} } from "./hot-reader.ts";`,
  ];
}

function renderWriterType(writerTypeName: string, snapshotTypeName: string): readonly string[] {
  return [
    `export type ${writerTypeName} = {`,
    `  readonly publish: (snapshot: ${snapshotTypeName}) => HotPublishResult;`,
    "};",
  ];
}

function renderCreateWriterFunction({
  createFunctionName,
  writerTypeName,
  snapshotTypeName,
  validateRegionFunctionName,
  validateSnapshotFunctionName,
  writeFunctionName,
}: {
  readonly createFunctionName: string;
  readonly writerTypeName: string;
  readonly snapshotTypeName: string;
  readonly validateRegionFunctionName: string;
  readonly validateSnapshotFunctionName: string;
  readonly writeFunctionName: string;
}): readonly string[] {
  return [
    `export function ${createFunctionName}(region: Uint8Array): ${writerTypeName} {`,
    `  ${validateRegionFunctionName}(region);`,
    "",
    "  const seqlock = new BigUint64Array(region.buffer, region.byteOffset + SEQLOCK_OFFSET, 1);",
    "  const publicationSequence = new BigUint64Array(",
    "    region.buffer,",
    "    region.byteOffset + PUBLICATION_SEQUENCE_OFFSET,",
    "    1,",
    "  );",
    "",
    "  return {",
    `    publish: (snapshot: ${snapshotTypeName}) => {`,
    `      ${validateSnapshotFunctionName}(snapshot);`,
    "      return publishHotRegion({",
    "        seqlock,",
    "        publicationSequence,",
    `        writeRegion: () => ${writeFunctionName}(region, snapshot),`,
    "      });",
    "    },",
    "  };",
    "}",
  ];
}

function renderValidateSnapshotFunction(
  validateSnapshotFunctionName: string,
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `export function ${validateSnapshotFunctionName}(snapshot: ${snapshotTypeName}): void {`,
    "  if (!isRecord(snapshot)) {",
    `    throw new TypeError(${stringLiteral(`${snapshotTypeName} must be an object`)});`,
    "  }",
    "",
    ...joinBlocks(fields.map((field) => field.validationSource)),
    "}",
  ];
}

function renderUncheckedWriteFunction(
  writeFunctionName: string,
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `export function ${writeFunctionName}(`,
    "  region: Uint8Array,",
    `  snapshot: ${snapshotTypeName},`,
    "): void {",
    "  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);",
    ...fields.flatMap((field) => field.writeSource),
    "}",
  ];
}

function renderHelperSources(helpers: readonly GeneratedHelper[]): readonly string[] {
  const sourcedHelpers = helpers.filter((helper) => helper.source.length > 0);

  if (sourcedHelpers.length === 0) {
    return [];
  }

  return [...joinBlocks(sourcedHelpers.map((helper) => helper.source.split("\n"))), ""];
}

function renderValidateRegionFunction(
  fixtureName: string,
  validateRegionFunctionName: string,
): readonly string[] {
  return [
    `function ${validateRegionFunctionName}(region: Uint8Array): void {`,
    "  if (!(region instanceof Uint8Array)) {",
    `    throw new TypeError(${stringLiteral(`${fixtureName} region must be a Uint8Array`)});`,
    "  }",
    "",
    "  if (!(region.buffer instanceof SharedArrayBuffer)) {",
    `    throw new TypeError(${stringLiteral(`${fixtureName} region must be backed by SharedArrayBuffer`)});`,
    "  }",
    "",
    "  if (region.byteLength < TOTAL_REGION_BYTE_LENGTH) {",
    `    throw new RangeError(\`${fixtureName} region must be at least \${TOTAL_REGION_BYTE_LENGTH} bytes\`);`,
    "  }",
    "",
    "  const absoluteSeqlockOffset = region.byteOffset + SEQLOCK_OFFSET;",
    "  if (absoluteSeqlockOffset % U64_BYTE_ALIGNMENT !== 0) {",
    `    throw new RangeError(${stringLiteral(`${fixtureName} seqlock view is not u64-aligned`)});`,
    "  }",
    "",
    "  const absolutePublicationSequenceOffset = region.byteOffset + PUBLICATION_SEQUENCE_OFFSET;",
    "  if (absolutePublicationSequenceOffset % U64_BYTE_ALIGNMENT !== 0) {",
    `    throw new RangeError(${stringLiteral(
      `${fixtureName} publicationSequence view is not u64-aligned`,
    )});`,
    "  }",
    "}",
  ];
}

function renderCommonHelpers(helpers: readonly GeneratedHelper[]): readonly string[] {
  const helperKeys = new Set(helpers.map((helper) => helper.key));
  const sources = [renderIsRecordHelper()];

  if (helperKeys.has("requireFiniteNumber")) {
    sources.push(renderRequireFiniteNumberHelper());
  }
  if (helperKeys.has("requireBoolean")) {
    sources.push(renderRequireBooleanHelper());
  }
  if (helperKeys.has("requireU32")) {
    sources.push(renderRequireU32Helper());
  }
  if (helperKeys.has("requireU64")) {
    sources.push(renderRequireU64Helper());
  }

  return joinBlocks(sources.map((source) => source.split("\n")));
}

function generateField(manifest: HotLayoutManifest, field: HotFieldEntry): GeneratedField {
  const symbol = toPascalCase(field.dotPath);
  const offsetConstant = `${toConstantStem(field.dotPath)}_OFFSET`;
  const snapshotField = `snapshot.${field.dotPath}`;

  switch (field.shape.kind) {
    case "FixedScalar":
      requireByteSpan(field, scalarByteWidth(field.shape.type));
      return {
        name: field.dotPath,
        symbol,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
        ],
        helpers: scalarValidationHelpers(field.shape.type),
        validationSource: [
          `${scalarValidationSource(field.shape.type)}(${snapshotField}, ${stringLiteral(
            field.dotPath,
          )});`,
        ],
        writeSource: [`  ${scalarWriteSource(field.shape.type, offsetConstant, snapshotField)}`],
      };

    case "FixedEnum": {
      const variantsSource = field.shape.variants
        .map((variant) => stringLiteral(variant))
        .join(", ");
      const variantsConstant = `${toConstantStem(field.dotPath)}_VARIANTS`;

      requireByteSpan(field, 1);
      return {
        name: field.dotPath,
        symbol,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          {
            name: variantsConstant,
            source: `const ${variantsConstant} = [${variantsSource}] as const;`,
          },
        ],
        helpers: [
          {
            key: `validate${symbol}`,
            source: renderFixedEnumValidationHelper({
              dotPath: field.dotPath,
              functionName: `validate${symbol}`,
              variantsConstant,
            }),
          },
        ],
        validationSource: [`validate${symbol}(${snapshotField});`],
        writeSource: [
          `  view.setUint8(${offsetConstant}, ${variantsConstant}.indexOf(${snapshotField}));`,
        ],
      };
    }

    case "FixedStringEncoded": {
      const byteLengthConstant = `${toConstantStem(field.dotPath)}_BYTE_LENGTH`;

      requireByteSpan(field, field.shape.byteLength);
      return {
        name: field.dotPath,
        symbol,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          {
            name: byteLengthConstant,
            source: `const ${byteLengthConstant} = ${field.shape.byteLength};`,
          },
        ],
        helpers: [
          {
            key: `validate${symbol}`,
            source: renderFixedStringValidationHelper({
              byteLengthConstant,
              dotPath: field.dotPath,
              functionName: `validate${symbol}`,
            }),
          },
          {
            key: `write${symbol}`,
            source: renderFixedStringWriteHelper({
              byteLengthConstant,
              functionName: `write${symbol}`,
              offsetConstant,
            }),
          },
        ],
        validationSource: [`validate${symbol}(${snapshotField});`],
        writeSource: [`  write${symbol}(view, ${snapshotField});`],
      };
    }

    case "FixedVector": {
      const shape = field.shape;
      const unitByteLength = scalarByteWidth(shape.elementType);
      const constantStem = toConstantStem(field.dotPath);
      const lengthConstant = `${constantStem}_LENGTH`;
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
      const typeSource = `readonly [${Array.from({ length: shape.length }, () =>
        scalarTypeSource(shape.elementType),
      ).join(", ")}]`;

      requireByteSpan(field, shape.length * unitByteLength);
      return {
        name: field.dotPath,
        symbol,
        constants: [
          {
            name: offsetConstant,
            source: `const ${offsetConstant} = ${field.absoluteOffset};`,
          },
          {
            name: lengthConstant,
            source: `const ${lengthConstant} = ${shape.length};`,
          },
          ...elementConstants,
        ],
        helpers: [
          {
            key: `validate${symbol}`,
            source: renderFixedVectorValidationHelper({
              dotPath: field.dotPath,
              elementType: shape.elementType,
              functionName: `validate${symbol}`,
              lengthConstant,
            }),
          },
          {
            key: `write${symbol}`,
            source: renderFixedVectorWriteHelper({
              elementType: shape.elementType,
              functionName: `write${symbol}`,
              typeSource,
              valueOffsets: elementConstants.map((constant) => constant.name),
            }),
          },
          ...scalarValidationHelpers(shape.elementType),
        ],
        validationSource: [`validate${symbol}(${snapshotField});`],
        writeSource: [`  write${symbol}(view, ${snapshotField});`],
      };
    }

    case "BoundedArray": {
      const shape = field.shape;
      const reservation = reservationFor(manifest, field);
      const unitByteLength = scalarByteWidth(shape.elementType);
      const constantStem = toConstantStem(field.dotPath);
      const countOffsetConstant = `${constantStem}_COUNT_OFFSET`;
      const elementsOffsetConstant = `${constantStem}_ELEMENTS_OFFSET`;
      const maxCountConstant = `${constantStem}_MAX_COUNT`;
      const unitByteLengthConstant = `${constantStem}_UNIT_BYTE_LENGTH`;

      if (reservation.maxCount !== shape.maxLength) {
        throw new Error(`${field.dotPath} reservation maxCount does not match maxLength`);
      }
      if (reservation.unitByteLength !== unitByteLength) {
        throw new Error(`${field.dotPath} reservation unitByteLength does not match element type`);
      }

      return {
        name: field.dotPath,
        symbol,
        constants: [
          {
            name: countOffsetConstant,
            source: `const ${countOffsetConstant} = ${reservation.countFieldOffset};`,
          },
          {
            name: elementsOffsetConstant,
            source: `const ${elementsOffsetConstant} = ${reservation.elementsOffset};`,
          },
          {
            name: maxCountConstant,
            source: `const ${maxCountConstant} = ${reservation.maxCount};`,
          },
          {
            name: unitByteLengthConstant,
            source: `const ${unitByteLengthConstant} = ${reservation.unitByteLength};`,
          },
        ],
        helpers: [
          {
            key: `validate${symbol}`,
            source: renderBoundedArrayValidationHelper({
              dotPath: field.dotPath,
              elementType: shape.elementType,
              functionName: `validate${symbol}`,
              maxCountConstant,
            }),
          },
          {
            key: `write${symbol}`,
            source: renderBoundedArrayWriteHelper({
              countOffsetConstant,
              elementType: shape.elementType,
              elementsOffsetConstant,
              functionName: `write${symbol}`,
              maxCountConstant,
              unitByteLengthConstant,
            }),
          },
          ...scalarValidationHelpers(shape.elementType),
        ],
        validationSource: [`validate${symbol}(${snapshotField});`],
        writeSource: [`  write${symbol}(view, ${snapshotField});`],
      };
    }

    default:
      return assertNever(field.shape, `${field.dotPath} shape is not supported`);
  }
}

function renderFixedEnumValidationHelper({
  dotPath,
  functionName,
  variantsConstant,
}: {
  readonly dotPath: string;
  readonly functionName: string;
  readonly variantsConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(value: unknown): void {`,
    `  if (typeof value !== "string" || !(${variantsConstant} as readonly string[]).includes(value)) {`,
    `    throw new RangeError(${stringLiteral(`${dotPath} must be one of the generated variants`)});`,
    "  }",
    "}",
  ]);
}

function renderFixedStringValidationHelper({
  byteLengthConstant,
  dotPath,
  functionName,
}: {
  readonly byteLengthConstant: string;
  readonly dotPath: string;
  readonly functionName: string;
}): string {
  return joinLines([
    `function ${functionName}(value: unknown): void {`,
    '  if (typeof value !== "string") {',
    `    throw new TypeError(${stringLiteral(`${dotPath} must be a string`)});`,
    "  }",
    "",
    `  if (value.length > ${byteLengthConstant}) {`,
    `    throw new RangeError(\`${dotPath} must fit in \${${byteLengthConstant}} ASCII bytes\`);`,
    "  }",
    "",
    "  for (let index = 0; index < value.length; index += 1) {",
    "    if (value.charCodeAt(index) > 0x7f) {",
    `      throw new RangeError(${stringLiteral(`${dotPath} must contain ASCII only`)});`,
    "    }",
    "  }",
    "}",
  ]);
}

function renderFixedStringWriteHelper({
  byteLengthConstant,
  functionName,
  offsetConstant,
}: {
  readonly byteLengthConstant: string;
  readonly functionName: string;
  readonly offsetConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(view: DataView, value: string): void {`,
    `  for (let index = 0; index < ${byteLengthConstant}; index += 1) {`,
    "    const byte = index < value.length ? value.charCodeAt(index) : 0;",
    `    view.setUint8(${offsetConstant} + index, byte);`,
    "  }",
    "}",
  ]);
}

function renderFixedVectorValidationHelper({
  dotPath,
  elementType,
  functionName,
  lengthConstant,
}: {
  readonly dotPath: string;
  readonly elementType: GeneratedWriterScalarTypeV0;
  readonly functionName: string;
  readonly lengthConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(value: unknown): void {`,
    `  if (!Array.isArray(value) || value.length !== ${lengthConstant}) {`,
    `    throw new RangeError(\`${dotPath} must contain exactly \${${lengthConstant}} elements\`);`,
    "  }",
    "",
    "  for (let index = 0; index < value.length; index += 1) {",
    `    ${scalarValidationSource(elementType)}(value[index], \`${dotPath}.\${index}\`);`,
    "  }",
    "}",
  ]);
}

function renderFixedVectorWriteHelper({
  elementType,
  functionName,
  typeSource,
  valueOffsets,
}: {
  readonly elementType: GeneratedWriterScalarTypeV0;
  readonly functionName: string;
  readonly typeSource: string;
  readonly valueOffsets: readonly string[];
}): string {
  return joinLines([
    `function ${functionName}(view: DataView, value: ${typeSource}): void {`,
    ...valueOffsets.map(
      (offsetConstant, index) =>
        `  ${scalarWriteSource(elementType, offsetConstant, `value[${index}]`)}`,
    ),
    "}",
  ]);
}

function renderBoundedArrayValidationHelper({
  dotPath,
  elementType,
  functionName,
  maxCountConstant,
}: {
  readonly dotPath: string;
  readonly elementType: GeneratedWriterScalarTypeV0;
  readonly functionName: string;
  readonly maxCountConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(value: unknown): void {`,
    "  if (!Array.isArray(value)) {",
    `    throw new TypeError(${stringLiteral(`${dotPath} must be an array`)});`,
    "  }",
    "",
    `  if (value.length > ${maxCountConstant}) {`,
    `    throw new RangeError(\`${dotPath} length must be <= \${${maxCountConstant}}\`);`,
    "  }",
    "",
    "  for (let index = 0; index < value.length; index += 1) {",
    `    ${scalarValidationSource(elementType)}(value[index], \`${dotPath}.\${index}\`);`,
    "  }",
    "}",
  ]);
}

function renderBoundedArrayWriteHelper({
  countOffsetConstant,
  elementType,
  elementsOffsetConstant,
  functionName,
  maxCountConstant,
  unitByteLengthConstant,
}: {
  readonly countOffsetConstant: string;
  readonly elementType: GeneratedWriterScalarTypeV0;
  readonly elementsOffsetConstant: string;
  readonly functionName: string;
  readonly maxCountConstant: string;
  readonly unitByteLengthConstant: string;
}): string {
  const elementOffset = `${elementsOffsetConstant} + index * ${unitByteLengthConstant}`;

  return joinLines([
    `function ${functionName}(view: DataView, value: readonly ${scalarTypeSource(
      elementType,
    )}[]): void {`,
    `  view.setUint32(${countOffsetConstant}, value.length, true);`,
    "",
    `  for (let index = 0; index < ${maxCountConstant}; index += 1) {`,
    "    if (index < value.length) {",
    `      ${scalarWriteSource(
      elementType,
      elementOffset,
      `value[index] as ${scalarTypeSource(elementType)}`,
    )}`,
    "    } else {",
    `      ${scalarZeroWriteSource(elementType, elementOffset)}`,
    "    }",
    "  }",
    "}",
  ]);
}

function collectGeneratedConstants(
  fields: readonly GeneratedField[],
): readonly GeneratedConstant[] {
  const constants: GeneratedConstant[] = [];
  const names = new Set<string>();

  for (const field of fields) {
    for (const constant of field.constants) {
      if (names.has(constant.name)) {
        throw new Error(`generated writer constant ${constant.name} is duplicated`);
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
          throw new Error(`generated writer helper ${helper.key} has conflicting sources`);
        }
        continue;
      }

      helpers.set(helper.key, helper);
    }
  }

  return [...helpers.values()];
}

function scalarValidationHelpers(type: GeneratedWriterScalarTypeV0): readonly GeneratedHelper[] {
  return [
    {
      key: scalarValidationSource(type),
      source: "",
    },
  ];
}

function scalarValidationSource(type: GeneratedWriterScalarTypeV0): string {
  switch (type) {
    case "bool":
      return "requireBoolean";
    case "f32":
    case "f64":
      return "requireFiniteNumber";
    case "u32":
      return "requireU32";
    case "u64":
      return "requireU64";
    default:
      return assertNever(type, "generated writer scalar type is not supported");
  }
}

function scalarWriteSource(
  type: GeneratedWriterScalarTypeV0,
  offsetSource: string,
  valueSource: string,
): string {
  switch (type) {
    case "bool":
      return `view.setUint8(${offsetSource}, ${valueSource} ? 1 : 0);`;
    case "f32":
      return `view.setFloat32(${offsetSource}, ${valueSource}, true);`;
    case "f64":
      return `view.setFloat64(${offsetSource}, ${valueSource}, true);`;
    case "u32":
      return `view.setUint32(${offsetSource}, ${valueSource}, true);`;
    case "u64":
      return `view.setBigUint64(${offsetSource}, ${valueSource}, true);`;
    default:
      return assertNever(type, "generated writer scalar type is not supported");
  }
}

function scalarZeroWriteSource(type: GeneratedWriterScalarTypeV0, offsetSource: string): string {
  switch (type) {
    case "bool":
      return `view.setUint8(${offsetSource}, 0);`;
    case "f32":
      return `view.setFloat32(${offsetSource}, 0, true);`;
    case "f64":
      return `view.setFloat64(${offsetSource}, 0, true);`;
    case "u32":
      return `view.setUint32(${offsetSource}, 0, true);`;
    case "u64":
      return `view.setBigUint64(${offsetSource}, 0n, true);`;
    default:
      return assertNever(type, "generated writer scalar type is not supported");
  }
}

function scalarTypeSource(type: GeneratedWriterScalarTypeV0): string {
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
      return assertNever(type, "generated writer scalar type is not supported");
  }
}

function scalarByteWidth(type: GeneratedWriterScalarTypeV0): number {
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
      return assertNever(type, "generated writer scalar type is not supported");
  }
}

function renderIsRecordHelper(): string {
  return joinLines([
    "function isRecord(value: unknown): value is Record<string, unknown> {",
    '  return typeof value === "object" && value !== null && !Array.isArray(value);',
    "}",
  ]);
}

function renderRequireFiniteNumberHelper(): string {
  const fieldNameTemplate = "$" + "{fieldName}";

  return joinLines([
    "function requireFiniteNumber(value: unknown, fieldName: string): void {",
    '  if (typeof value !== "number" || !Number.isFinite(value)) {',
    `    throw new TypeError(\`${fieldNameTemplate} must be a finite number\`);`,
    "  }",
    "}",
  ]);
}

function renderRequireBooleanHelper(): string {
  const fieldNameTemplate = "$" + "{fieldName}";

  return joinLines([
    "function requireBoolean(value: unknown, fieldName: string): void {",
    '  if (typeof value !== "boolean") {',
    `    throw new TypeError(\`${fieldNameTemplate} must be a boolean\`);`,
    "  }",
    "}",
  ]);
}

function renderRequireU32Helper(): string {
  const fieldNameTemplate = "$" + "{fieldName}";

  return joinLines([
    "function requireU32(value: unknown, fieldName: string): void {",
    '  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {',
    `    throw new RangeError(\`${fieldNameTemplate} must be an integer in u32 range\`);`,
    "  }",
    "}",
  ]);
}

function renderRequireU64Helper(): string {
  const fieldNameTemplate = "$" + "{fieldName}";

  return joinLines([
    "function requireU64(value: unknown, fieldName: string): void {",
    '  if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {',
    `    throw new RangeError(\`${fieldNameTemplate} must be a bigint in u64 range\`);`,
    "  }",
    "}",
  ]);
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

function isGeneratedWriterScalarTypeV0(value: unknown): value is GeneratedWriterScalarTypeV0 {
  return (
    value === "bool" || value === "f32" || value === "f64" || value === "u32" || value === "u64"
  );
}

function isFieldName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-zA-Z0-9]*$/.test(value);
}

function isSafeGeneratedPropertyName(value: string): boolean {
  return (
    isFieldName(value) &&
    !typescriptReservedWords.has(value) &&
    !unsafeGeneratedPropertyNames.has(value)
  );
}

function isSafeFixtureName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

function isSafeSymbolStem(value: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(value) && !typescriptReservedWords.has(value);
}

function toPascalCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function toConstantStem(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function withFinalNewline(lines: readonly string[]): string {
  return `${joinLines(lines)}\n`;
}

function joinBlocks(blocks: readonly (readonly string[])[]): readonly string[] {
  const lines: string[] = [];

  for (const [index, block] of blocks.entries()) {
    if (index > 0) {
      lines.push("");
    }
    lines.push(...block);
  }

  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

const unsafeGeneratedPropertyNames = new Set([
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "prototype",
  "toString",
  "valueOf",
]);

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
