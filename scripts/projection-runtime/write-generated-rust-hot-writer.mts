import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  dotPathToConstantStem,
  dotPathToRustSnakeIdentifier,
  dotPathToSymbolName,
  toPascalCase,
} from "./generated-hot/identifiers.mts";
import {
  type HotFieldEntry,
  type HotLayoutManifest,
  readHotLayoutManifest,
  requireByteSpan,
  requireRangeEnd,
  requireSafeNonNegativeInteger,
  requireSafePositiveInteger,
  reservationFor,
  validateGeneratedArtifactProfile,
  validateHotLayoutManifest,
} from "./generated-hot/layout-manifest.mts";
import { type GeneratedHotScalarTypeV0, scalarByteWidth } from "./generated-hot/scalars-v0.mts";
import { assertNever, joinBlocks, joinLines, withFinalNewline } from "./generated-hot/source.mts";

type GeneratedConstant = {
  readonly name: string;
  readonly source: string;
};

type GeneratedEnum = {
  readonly typeName: string;
  readonly source: string;
};

type GeneratedHelper = {
  readonly key: string;
  readonly source: string;
};

type GeneratedField = {
  readonly name: string;
  readonly rustName: string;
  readonly typeSource: string;
  readonly constants: readonly GeneratedConstant[];
  readonly enums: readonly GeneratedEnum[];
  readonly helpers: readonly GeneratedHelper[];
  readonly validationSource: readonly string[];
  readonly writeSource: readonly string[];
};

type WriteGeneratedRustHotWriterInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

export async function writeGeneratedRustHotWriter({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedRustHotWriterInput): Promise<void> {
  validateGeneratedArtifactProfile({ fixtureName, symbolStem, generatedFromPath });

  const manifest = await readHotLayoutManifest(manifestPath);
  validateRustHotLayoutManifest(manifest, manifestPath);

  const source = renderRustHotWriter({
    fixtureName,
    symbolStem,
    generatedFromPath,
    manifest,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source);
}

function validateRustHotLayoutManifest(manifest: HotLayoutManifest, manifestPath: string): void {
  requireSafePositiveInteger(manifest.blockASize, `${manifestPath}.blockASize`);
  requireSafeNonNegativeInteger(manifest.blockBStartOffset, `${manifestPath}.blockBStartOffset`);
  requireSafeNonNegativeInteger(
    manifest.baselineEpochOffset,
    `${manifestPath}.baselineEpochOffset`,
  );
  requireSafeNonNegativeInteger(
    manifest.continuityGenOffset,
    `${manifestPath}.continuityGenOffset`,
  );
  requireSafeNonNegativeInteger(manifest.fieldDataOrigin, `${manifestPath}.fieldDataOrigin`);
  requireSafeNonNegativeInteger(
    manifest.publicationSeqOffset,
    `${manifestPath}.publicationSeqOffset`,
  );
  requireRangeEnd(0, manifest.blockASize, manifest.totalRegionByteLength, manifestPath);
  requireRangeEnd(
    manifest.baselineEpochOffset,
    4,
    manifest.totalRegionByteLength,
    `${manifestPath}.baselineEpochOffset`,
  );
  requireRangeEnd(
    manifest.continuityGenOffset,
    4,
    manifest.totalRegionByteLength,
    `${manifestPath}.continuityGenOffset`,
  );
  requireRangeEnd(
    manifest.publicationSeqOffset,
    8,
    manifest.totalRegionByteLength,
    `${manifestPath}.publicationSeqOffset`,
  );
  validateHotLayoutManifest(manifest, manifestPath, {
    getGeneratedConstantNames: generatedConstantNamesFor,
    extraRootConstantNames: [
      "BASELINE_EPOCH_OFFSET",
      "BLOCK_A_SIZE",
      "BLOCK_B_START_OFFSET",
      "CONTINUITY_GENERATION_OFFSET",
      "FIELD_DATA_ORIGIN",
      "PUBLICATION_SEQUENCE_OFFSET",
    ],
  });
}

function generatedConstantNamesFor(field: HotFieldEntry): readonly string[] {
  const constantStem = dotPathToConstantStem(field.dotPath);
  const offsetConstant = `${constantStem}_OFFSET`;

  switch (field.shape.kind) {
    case "FixedScalar":
      return [offsetConstant];

    case "FixedEnum":
      return [offsetConstant];

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

function renderRustHotWriter(input: {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly generatedFromPath: string;
  readonly manifest: HotLayoutManifest;
}): string {
  const stem = validateRustSnakeIdentifier(
    input.symbolStem.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(),
    "symbolStem",
  );
  const snapshotTypeName = `${input.symbolStem}Snapshot`;
  const publicationTypeName = `${input.symbolStem}Publication`;
  const publishResultTypeName = `${input.symbolStem}PublishResult`;
  const errorTypeName = `${input.symbolStem}WriteError`;
  const fields = input.manifest.fields.map((field) =>
    generateField(input.manifest, input, field, errorTypeName),
  );
  const publishFunctionName = `publish_${stem}_snapshot`;
  const validateFunctionName = `validate_${stem}_snapshot`;
  const writeSnapshotFunctionName = `write_${stem}_snapshot`;
  const writeFieldsFunctionName = `write_${stem}_snapshot_fields`;
  const constants = collectGeneratedConstants(fields);
  const enums = collectGeneratedEnums(fields);
  const helpers = collectGeneratedHelpers(fields);

  return withFinalNewline([
    `// Generated from ${input.generatedFromPath}. Do not edit by hand.`,
    "",
    ...renderEnums(enums),
    ...renderSnapshotStruct(snapshotTypeName, fields),
    "",
    ...renderPublicationStruct(publicationTypeName),
    "",
    ...renderPublishResultStruct(publishResultTypeName),
    "",
    ...renderErrorEnum(errorTypeName),
    "",
    ...renderRootConstants(input.manifest),
    ...constants.map((constant) => constant.source),
    "",
    ...renderPublishFunction({
      errorTypeName,
      publicationTypeName,
      publishFunctionName,
      publishResultTypeName,
      snapshotTypeName,
      validateFunctionName,
      writeFieldsFunctionName,
    }),
    "",
    ...renderWriteSnapshotFunction({
      errorTypeName,
      snapshotTypeName,
      validateFunctionName,
      writeFieldsFunctionName,
      writeSnapshotFunctionName,
    }),
    "",
    ...renderValidateSnapshotFunction(validateFunctionName, snapshotTypeName, fields),
    "",
    ...renderWriteFieldsFunction(writeFieldsFunctionName, snapshotTypeName, fields),
    "",
    ...renderHelperSources(helpers),
    ...renderCommonHelpers(errorTypeName),
  ]);
}

function renderEnums(enums: readonly GeneratedEnum[]): readonly string[] {
  if (enums.length === 0) {
    return [];
  }

  return [...joinBlocks(enums.map((entry) => entry.source.split("\n"))), ""];
}

function renderSnapshotStruct(
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    "#[derive(Clone, Copy, Debug, PartialEq)]",
    `pub struct ${snapshotTypeName}<'a> {`,
    ...fields.map((field) => `    pub ${field.rustName}: ${field.typeSource},`),
    "}",
  ];
}

function renderPublicationStruct(publicationTypeName: string): readonly string[] {
  return [
    "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
    `pub struct ${publicationTypeName} {`,
    "    pub baseline_epoch: u32,",
    "    pub continuity_generation: u32,",
    "}",
  ];
}

function renderPublishResultStruct(publishResultTypeName: string): readonly string[] {
  return [
    "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
    `pub struct ${publishResultTypeName} {`,
    "    pub previous_seqlock_counter: u64,",
    "    pub seqlock_counter: u64,",
    "    pub previous_publication_sequence: u64,",
    "    pub publication_sequence: u64,",
    "}",
  ];
}

function renderErrorEnum(errorTypeName: string): readonly string[] {
  return [
    "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
    `pub enum ${errorTypeName} {`,
    "    RegionTooShort { expected_minimum: usize, actual: usize },",
    "    BlockALength { expected: usize, actual: usize },",
    "    WriterActiveSeqlock { counter: u64 },",
    "    SeqlockOverflow { counter: u64 },",
    "    PublicationSequenceOverflow { sequence: u64 },",
    "    LayoutRangeOutOfBounds {",
    "        field: &'static str,",
    "        offset: usize,",
    "        byte_length: usize,",
    "        total_region_byte_length: usize,",
    "    },",
    "    LayoutOverlapsBlockA {",
    "        field: &'static str,",
    "        offset: usize,",
    "        byte_length: usize,",
    "        block_a_size: usize,",
    "    },",
    "    LayoutRangesOverlap {",
    "        first_field: &'static str,",
    "        first_offset: usize,",
    "        first_byte_length: usize,",
    "        second_field: &'static str,",
    "        second_offset: usize,",
    "        second_byte_length: usize,",
    "    },",
    "    BoundedArrayOverflow { field: &'static str, max_count: usize, actual: usize },",
    "    FixedStringTooLong { field: &'static str, max_bytes: usize, actual_bytes: usize },",
    "    FixedStringNonAscii { field: &'static str },",
    "}",
    "",
    `impl From<hot_publication::HotPublicationError> for ${errorTypeName} {`,
    "    fn from(error: hot_publication::HotPublicationError) -> Self {",
    "        match error {",
    "            hot_publication::HotPublicationError::RegionTooShort { expected_minimum, actual } =>",
    `                ${errorTypeName}::RegionTooShort { expected_minimum, actual },`,
    "            hot_publication::HotPublicationError::BlockALength { expected, actual } =>",
    `                ${errorTypeName}::BlockALength { expected, actual },`,
    "            hot_publication::HotPublicationError::WriterActiveSeqlock { counter } =>",
    `                ${errorTypeName}::WriterActiveSeqlock { counter },`,
    "            hot_publication::HotPublicationError::SeqlockOverflow { counter } =>",
    `                ${errorTypeName}::SeqlockOverflow { counter },`,
    "            hot_publication::HotPublicationError::PublicationSequenceOverflow { sequence } =>",
    `                ${errorTypeName}::PublicationSequenceOverflow { sequence },`,
    "            hot_publication::HotPublicationError::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length } =>",
    `                ${errorTypeName}::LayoutRangeOutOfBounds { field, offset, byte_length, total_region_byte_length },`,
    "            hot_publication::HotPublicationError::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size } =>",
    `                ${errorTypeName}::LayoutOverlapsBlockA { field, offset, byte_length, block_a_size },`,
    "            hot_publication::HotPublicationError::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length } =>",
    `                ${errorTypeName}::LayoutRangesOverlap { first_field, first_offset, first_byte_length, second_field, second_offset, second_byte_length },`,
    "        }",
    "    }",
    "}",
  ];
}

function renderRootConstants(manifest: HotLayoutManifest): readonly string[] {
  return [
    `pub const BLOCK_A_SIZE: usize = ${manifest.blockASize};`,
    `pub const BLOCK_B_START_OFFSET: usize = ${manifest.blockBStartOffset};`,
    `pub const BASELINE_EPOCH_OFFSET: usize = ${manifest.baselineEpochOffset};`,
    `pub const CONTINUITY_GENERATION_OFFSET: usize = ${manifest.continuityGenOffset};`,
    `pub const FIELD_DATA_ORIGIN: usize = ${manifest.fieldDataOrigin};`,
    `pub const SEQLOCK_OFFSET: usize = ${manifest.seqlockOffset};`,
    `pub const PUBLICATION_SEQUENCE_OFFSET: usize = ${manifest.publicationSeqOffset};`,
    `pub const TOTAL_REGION_BYTE_LENGTH: usize = ${manifest.totalRegionByteLength};`,
  ];
}

function renderPublishFunction({
  errorTypeName,
  publicationTypeName,
  publishFunctionName,
  publishResultTypeName,
  snapshotTypeName,
  validateFunctionName,
  writeFieldsFunctionName,
}: {
  readonly errorTypeName: string;
  readonly publicationTypeName: string;
  readonly publishFunctionName: string;
  readonly publishResultTypeName: string;
  readonly snapshotTypeName: string;
  readonly validateFunctionName: string;
  readonly writeFieldsFunctionName: string;
}): readonly string[] {
  return [
    `pub fn ${publishFunctionName}(`,
    "    region: &mut [u8],",
    "    block_a: &[u8],",
    `    publication: ${publicationTypeName},`,
    `    snapshot: &${snapshotTypeName}<'_>,`,
    `) -> Result<${publishResultTypeName}, ${errorTypeName}> {`,
    `    ${validateFunctionName}(snapshot)?;`,
    "",
    "    let mut region_handle = hot_publication::HotPublicationRegion::bind(",
    "        hot_publication::HotPublicationLayout {",
    "            total_region_byte_length: TOTAL_REGION_BYTE_LENGTH,",
    "            block_a_size: BLOCK_A_SIZE,",
    "            seqlock_offset: SEQLOCK_OFFSET,",
    "            baseline_epoch_offset: BASELINE_EPOCH_OFFSET,",
    "            continuity_generation_offset: CONTINUITY_GENERATION_OFFSET,",
    "            publication_sequence_offset: PUBLICATION_SEQUENCE_OFFSET,",
    "        },",
    "        region,",
    "    )?;",
    "    let result = region_handle.publish(",
    "        block_a,",
    "        hot_publication::HotPublication {",
    "            baseline_epoch: publication.baseline_epoch,",
    "            continuity_generation: publication.continuity_generation,",
    "        },",
    `        |region| ${writeFieldsFunctionName}(region, snapshot),`,
    "    )?;",
    "",
    `    Ok(${publishResultTypeName} {`,
    "        previous_seqlock_counter: result.previous_seqlock_counter,",
    "        seqlock_counter: result.seqlock_counter,",
    "        previous_publication_sequence: result.previous_publication_sequence,",
    "        publication_sequence: result.publication_sequence,",
    "    })",
    "}",
  ];
}

function renderWriteSnapshotFunction({
  errorTypeName,
  snapshotTypeName,
  validateFunctionName,
  writeFieldsFunctionName,
  writeSnapshotFunctionName,
}: {
  readonly errorTypeName: string;
  readonly snapshotTypeName: string;
  readonly validateFunctionName: string;
  readonly writeFieldsFunctionName: string;
  readonly writeSnapshotFunctionName: string;
}): readonly string[] {
  return [
    `pub fn ${writeSnapshotFunctionName}(`,
    "    region: &mut [u8],",
    `    snapshot: &${snapshotTypeName}<'_>,`,
    `) -> Result<(), ${errorTypeName}> {`,
    "    require_region_length(region)?;",
    `    ${validateFunctionName}(snapshot)?;`,
    `    ${writeFieldsFunctionName}(region, snapshot);`,
    "    Ok(())",
    "}",
  ];
}

function renderValidateSnapshotFunction(
  validateFunctionName: string,
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `pub fn ${validateFunctionName}(snapshot: &${snapshotTypeName}<'_>) -> Result<(), ${errorTypeNameForSnapshot(
      snapshotTypeName,
    )}> {`,
    ...fields.flatMap((field) => field.validationSource),
    "    Ok(())",
    "}",
  ];
}

function errorTypeNameForSnapshot(snapshotTypeName: string): string {
  return snapshotTypeName.replace(/Snapshot$/, "WriteError");
}

function renderWriteFieldsFunction(
  writeFieldsFunctionName: string,
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `fn ${writeFieldsFunctionName}(region: &mut [u8], snapshot: &${snapshotTypeName}<'_>) {`,
    ...fields.flatMap((field) => field.writeSource),
    "}",
  ];
}

function renderHelperSources(helpers: readonly GeneratedHelper[]): readonly string[] {
  if (helpers.length === 0) {
    return [];
  }

  return [...joinBlocks(helpers.map((helper) => helper.source.split("\n"))), ""];
}

function renderCommonHelpers(errorTypeName: string): readonly string[] {
  return joinBlocks(
    [
      renderRequireRegionLengthHelper(errorTypeName),
      renderWriteU32LeHelper(),
      renderWriteU64LeHelper(),
      renderWriteF32LeHelper(),
      renderWriteF64LeHelper(),
    ].map((source) => source.split("\n")),
  );
}

function generateField(
  manifest: HotLayoutManifest,
  input: { readonly symbolStem: string },
  field: HotFieldEntry,
  errorTypeName: string,
): GeneratedField {
  const symbol = dotPathToSymbolName(field.dotPath);
  const constantStem = dotPathToConstantStem(field.dotPath);
  const rustName = validateRustSnakeIdentifier(
    dotPathToRustSnakeIdentifier(field.dotPath),
    field.dotPath,
  );
  const snapshotField = `snapshot.${rustName}`;
  const offsetConstant = `${constantStem}_OFFSET`;

  switch (field.shape.kind) {
    case "FixedScalar":
      requireByteSpan(field, scalarByteWidth(field.shape.type));
      return {
        name: field.dotPath,
        rustName,
        typeSource: rustScalarTypeSource(field.shape.type),
        constants: [
          {
            name: offsetConstant,
            source: `pub const ${offsetConstant}: usize = ${field.absoluteOffset};`,
          },
        ],
        enums: [],
        helpers: [],
        validationSource: [],
        writeSource: [`    ${scalarWriteSource(field.shape.type, offsetConstant, snapshotField)}`],
      };

    case "FixedEnum": {
      const enumTypeName = `${input.symbolStem}${symbol}`;

      requireByteSpan(field, 1);
      return {
        name: field.dotPath,
        rustName,
        typeSource: enumTypeName,
        constants: [
          {
            name: offsetConstant,
            source: `pub const ${offsetConstant}: usize = ${field.absoluteOffset};`,
          },
        ],
        enums: [
          {
            typeName: enumTypeName,
            source: renderFixedEnum({
              enumTypeName,
              variants: field.shape.variants,
            }),
          },
        ],
        helpers: [],
        validationSource: [],
        writeSource: [`    region[${offsetConstant}] = ${snapshotField}.to_u8();`],
      };
    }

    case "FixedStringEncoded": {
      const byteLengthConstant = `${constantStem}_BYTE_LENGTH`;

      requireByteSpan(field, field.shape.byteLength);
      return {
        name: field.dotPath,
        rustName,
        typeSource: "&'a str",
        constants: [
          {
            name: offsetConstant,
            source: `pub const ${offsetConstant}: usize = ${field.absoluteOffset};`,
          },
          {
            name: byteLengthConstant,
            source: `pub const ${byteLengthConstant}: usize = ${field.shape.byteLength};`,
          },
        ],
        enums: [],
        helpers: [
          {
            key: `validate_${rustName}`,
            source: renderFixedStringValidationHelper({
              byteLengthConstant,
              dotPath: field.dotPath,
              errorTypeName,
              functionName: `validate_${rustName}`,
            }),
          },
          {
            key: `write_${rustName}`,
            source: renderFixedStringWriteHelper({
              byteLengthConstant,
              functionName: `write_${rustName}`,
              offsetConstant,
            }),
          },
        ],
        validationSource: [`    validate_${rustName}(${snapshotField})?;`],
        writeSource: [`    write_${rustName}(region, ${snapshotField});`],
      };
    }

    case "FixedVector": {
      const shape = field.shape;
      const unitByteLength = scalarByteWidth(shape.elementType);
      const lengthConstant = `${constantStem}_LENGTH`;
      const elementConstants = Array.from({ length: shape.length }, (_, index) => {
        const name = `${constantStem}_${index}_OFFSET`;
        return {
          name,
          source:
            index === 0
              ? `pub const ${name}: usize = ${offsetConstant};`
              : `pub const ${name}: usize = ${field.absoluteOffset + index * unitByteLength};`,
        };
      });

      requireByteSpan(field, shape.length * unitByteLength);
      return {
        name: field.dotPath,
        rustName,
        typeSource: `[${rustScalarTypeSource(shape.elementType)}; ${shape.length}]`,
        constants: [
          {
            name: offsetConstant,
            source: `pub const ${offsetConstant}: usize = ${field.absoluteOffset};`,
          },
          {
            name: lengthConstant,
            source: `pub const ${lengthConstant}: usize = ${shape.length};`,
          },
          ...elementConstants,
        ],
        enums: [],
        helpers: [
          {
            key: `write_${rustName}`,
            source: renderFixedVectorWriteHelper({
              elementType: shape.elementType,
              functionName: `write_${rustName}`,
              length: shape.length,
              valueOffsets: elementConstants.map((constant) => constant.name),
            }),
          },
        ],
        validationSource: [],
        writeSource: [`    write_${rustName}(region, &${snapshotField});`],
      };
    }

    case "BoundedArray": {
      const shape = field.shape;
      const reservation = reservationFor(manifest, field);
      const unitByteLength = scalarByteWidth(shape.elementType);
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
        rustName,
        typeSource: `&'a [${rustScalarTypeSource(shape.elementType)}]`,
        constants: [
          {
            name: countOffsetConstant,
            source: `pub const ${countOffsetConstant}: usize = ${reservation.countFieldOffset};`,
          },
          {
            name: elementsOffsetConstant,
            source: `pub const ${elementsOffsetConstant}: usize = ${reservation.elementsOffset};`,
          },
          {
            name: maxCountConstant,
            source: `pub const ${maxCountConstant}: usize = ${reservation.maxCount};`,
          },
          {
            name: unitByteLengthConstant,
            source: `pub const ${unitByteLengthConstant}: usize = ${reservation.unitByteLength};`,
          },
        ],
        enums: [],
        helpers: [
          {
            key: `validate_${rustName}`,
            source: renderBoundedArrayValidationHelper({
              dotPath: field.dotPath,
              errorTypeName,
              functionName: `validate_${rustName}`,
              maxCountConstant,
            }),
          },
          {
            key: `write_${rustName}`,
            source: renderBoundedArrayWriteHelper({
              countOffsetConstant,
              elementType: shape.elementType,
              elementsOffsetConstant,
              functionName: `write_${rustName}`,
              maxCountConstant,
              unitByteLengthConstant,
            }),
          },
        ],
        validationSource: [`    validate_${rustName}(${snapshotField})?;`],
        writeSource: [`    write_${rustName}(region, ${snapshotField});`],
      };
    }

    default:
      return assertNever(field.shape, `${field.dotPath} shape is not supported`);
  }
}

function renderFixedEnum({
  enumTypeName,
  variants,
}: {
  readonly enumTypeName: string;
  readonly variants: readonly string[];
}): string {
  return joinLines([
    "#[derive(Clone, Copy, Debug, Eq, PartialEq)]",
    `pub enum ${enumTypeName} {`,
    ...variants.map((variant) => `    ${toRustPascalIdentifier(variant, enumTypeName)},`),
    "}",
    "",
    `impl ${enumTypeName} {`,
    "    fn to_u8(self) -> u8 {",
    "        match self {",
    ...variants.map(
      (variant, index) =>
        `            Self::${toRustPascalIdentifier(variant, enumTypeName)} => ${index},`,
    ),
    "        }",
    "    }",
    "}",
  ]);
}

function renderFixedStringValidationHelper({
  byteLengthConstant,
  dotPath,
  errorTypeName,
  functionName,
}: {
  readonly byteLengthConstant: string;
  readonly dotPath: string;
  readonly errorTypeName: string;
  readonly functionName: string;
}): string {
  return joinLines([
    `fn ${functionName}(value: &str) -> Result<(), ${errorTypeName}> {`,
    "    let bytes = value.as_bytes();",
    `    if bytes.len() > ${byteLengthConstant} {`,
    `        return Err(${errorTypeName}::FixedStringTooLong {`,
    `            field: ${rustStringLiteral(dotPath)},`,
    `            max_bytes: ${byteLengthConstant},`,
    "            actual_bytes: bytes.len(),",
    "        });",
    "    }",
    "    if !bytes.is_ascii() {",
    `        return Err(${errorTypeName}::FixedStringNonAscii {`,
    `            field: ${rustStringLiteral(dotPath)},`,
    "        });",
    "    }",
    "    Ok(())",
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
    `fn ${functionName}(region: &mut [u8], value: &str) {`,
    "    let bytes = value.as_bytes();",
    `    for index in 0..${byteLengthConstant} {`,
    "        let byte = if index < bytes.len() { bytes[index] } else { 0 };",
    `        region[${offsetConstant} + index] = byte;`,
    "    }",
    "}",
  ]);
}

function renderFixedVectorWriteHelper({
  elementType,
  functionName,
  length,
  valueOffsets,
}: {
  readonly elementType: GeneratedHotScalarTypeV0;
  readonly functionName: string;
  readonly length: number;
  readonly valueOffsets: readonly string[];
}): string {
  return joinLines([
    `fn ${functionName}(`,
    "    region: &mut [u8],",
    `    value: &[${rustScalarTypeSource(elementType)}; ${length}],`,
    ") {",
    ...valueOffsets.map(
      (offsetConstant, index) =>
        `    ${scalarWriteSource(elementType, offsetConstant, `value[${index}]`)}`,
    ),
    "}",
  ]);
}

function renderBoundedArrayValidationHelper({
  dotPath,
  errorTypeName,
  functionName,
  maxCountConstant,
}: {
  readonly dotPath: string;
  readonly errorTypeName: string;
  readonly functionName: string;
  readonly maxCountConstant: string;
}): string {
  return joinLines([
    `fn ${functionName}<T>(value: &[T]) -> Result<(), ${errorTypeName}> {`,
    `    if value.len() > ${maxCountConstant} {`,
    `        return Err(${errorTypeName}::BoundedArrayOverflow {`,
    `            field: ${rustStringLiteral(dotPath)},`,
    `            max_count: ${maxCountConstant},`,
    "            actual: value.len(),",
    "        });",
    "    }",
    "    Ok(())",
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
  readonly elementType: GeneratedHotScalarTypeV0;
  readonly elementsOffsetConstant: string;
  readonly functionName: string;
  readonly maxCountConstant: string;
  readonly unitByteLengthConstant: string;
}): string {
  const elementOffset = `${elementsOffsetConstant} + index * ${unitByteLengthConstant}`;

  return joinLines([
    `fn ${functionName}(region: &mut [u8], value: &[${rustScalarTypeSource(elementType)}]) {`,
    `    write_u32_le(region, ${countOffsetConstant}, value.len() as u32);`,
    `    for index in 0..${maxCountConstant} {`,
    "        if index < value.len() {",
    `            ${scalarWriteSource(elementType, elementOffset, "value[index]")}`,
    "        } else {",
    `            ${scalarZeroWriteSource(elementType, elementOffset)}`,
    "        }",
    "    }",
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
        throw new Error(`generated Rust writer constant ${constant.name} is duplicated`);
      }
      names.add(constant.name);
      constants.push(constant);
    }
  }

  return constants;
}

function collectGeneratedEnums(fields: readonly GeneratedField[]): readonly GeneratedEnum[] {
  const enums = new Map<string, GeneratedEnum>();

  for (const field of fields) {
    for (const generatedEnum of field.enums) {
      const existing = enums.get(generatedEnum.typeName);
      if (existing !== undefined) {
        if (existing.source !== generatedEnum.source) {
          throw new Error(`generated Rust writer enum ${generatedEnum.typeName} is duplicated`);
        }
        continue;
      }
      enums.set(generatedEnum.typeName, generatedEnum);
    }
  }

  return [...enums.values()];
}

function collectGeneratedHelpers(fields: readonly GeneratedField[]): readonly GeneratedHelper[] {
  const helpers = new Map<string, GeneratedHelper>();

  for (const field of fields) {
    for (const helper of field.helpers) {
      const existing = helpers.get(helper.key);
      if (existing !== undefined) {
        if (existing.source !== helper.source) {
          throw new Error(`generated Rust writer helper ${helper.key} has conflicting sources`);
        }
        continue;
      }

      helpers.set(helper.key, helper);
    }
  }

  return [...helpers.values()];
}

function scalarWriteSource(
  type: GeneratedHotScalarTypeV0,
  offsetSource: string,
  valueSource: string,
): string {
  switch (type) {
    case "bool":
      return `region[${offsetSource}] = u8::from(${valueSource});`;
    case "f32":
      return `write_f32_le(region, ${offsetSource}, ${valueSource});`;
    case "f64":
      return `write_f64_le(region, ${offsetSource}, ${valueSource});`;
    case "u32":
      return `write_u32_le(region, ${offsetSource}, ${valueSource});`;
    case "u64":
      return `write_u64_le(region, ${offsetSource}, ${valueSource});`;
    default:
      return assertNever(type, "generated Rust writer scalar type is not supported");
  }
}

function scalarZeroWriteSource(type: GeneratedHotScalarTypeV0, offsetSource: string): string {
  switch (type) {
    case "bool":
      return `region[${offsetSource}] = 0;`;
    case "f32":
      return `write_f32_le(region, ${offsetSource}, 0.0);`;
    case "f64":
      return `write_f64_le(region, ${offsetSource}, 0.0);`;
    case "u32":
      return `write_u32_le(region, ${offsetSource}, 0);`;
    case "u64":
      return `write_u64_le(region, ${offsetSource}, 0);`;
    default:
      return assertNever(type, "generated Rust writer scalar type is not supported");
  }
}

function rustScalarTypeSource(type: GeneratedHotScalarTypeV0): string {
  switch (type) {
    case "bool":
      return "bool";
    case "f32":
      return "f32";
    case "f64":
      return "f64";
    case "u32":
      return "u32";
    case "u64":
      return "u64";
    default:
      return assertNever(type, "generated Rust writer scalar type is not supported");
  }
}

function renderRequireRegionLengthHelper(errorTypeName: string): string {
  return joinLines([
    `fn require_region_length(region: &[u8]) -> Result<(), ${errorTypeName}> {`,
    "    if region.len() < TOTAL_REGION_BYTE_LENGTH {",
    `        return Err(${errorTypeName}::RegionTooShort {`,
    "            expected_minimum: TOTAL_REGION_BYTE_LENGTH,",
    "            actual: region.len(),",
    "        });",
    "    }",
    "    Ok(())",
    "}",
  ]);
}

function renderWriteU32LeHelper(): string {
  return joinLines([
    "fn write_u32_le(region: &mut [u8], offset: usize, value: u32) {",
    "    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());",
    "}",
  ]);
}

function renderWriteU64LeHelper(): string {
  return joinLines([
    "fn write_u64_le(region: &mut [u8], offset: usize, value: u64) {",
    "    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());",
    "}",
  ]);
}

function renderWriteF32LeHelper(): string {
  return joinLines([
    "fn write_f32_le(region: &mut [u8], offset: usize, value: f32) {",
    "    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());",
    "}",
  ]);
}

function renderWriteF64LeHelper(): string {
  return joinLines([
    "fn write_f64_le(region: &mut [u8], offset: usize, value: f64) {",
    "    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());",
    "}",
  ]);
}

function validateRustSnakeIdentifier(normalized: string, label: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(normalized) || rustKeywords.has(normalized)) {
    throw new Error(`${label} is not a safe generated Rust snake_case identifier`);
  }

  return normalized;
}

function toRustPascalIdentifier(value: string, label: string): string {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) {
    throw new Error(`${label} variant ${value} is not supported by generated Rust writer v0`);
  }

  const normalized = toPascalCase(value);
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(normalized) || rustKeywords.has(normalized.toLowerCase())) {
    throw new Error(`${label} variant ${value} is not a safe generated Rust enum variant`);
  }

  return normalized;
}

function rustStringLiteral(value: string): string {
  return JSON.stringify(value);
}

const rustKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);
