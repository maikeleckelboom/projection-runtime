import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { toConstantStem, toPascalCase } from "./generated-hot/identifiers.mts";
import {
  type HotFieldEntry,
  type HotLayoutManifest,
  readHotLayoutManifest,
  requireByteSpan,
  requireRangeEnd,
  requireSafeNonNegativeInteger,
  reservationFor,
  validateGeneratedArtifactProfile,
  validateHotLayoutManifest,
} from "./generated-hot/layout-manifest.mts";
import {
  type GeneratedHotScalarTypeV0,
  scalarByteWidth,
  scalarTypeSource,
} from "./generated-hot/scalars-v0.mts";
import {
  assertNever,
  joinBlocks,
  joinLines,
  stringLiteral,
  withFinalNewline,
} from "./generated-hot/source.mts";

type GeneratedConstant = {
  readonly name: string;
  readonly source: string;
};

type GeneratedHelper = {
  readonly key: string;
  readonly source: string;
};

type GeneratedField = {
  readonly name: string;
  readonly symbol: string;
  readonly constants: readonly GeneratedConstant[];
  readonly helpers: readonly GeneratedHelper[];
  readonly validationSource: readonly string[];
  readonly writeSource: readonly string[];
};

type WriteGeneratedHotWriterInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
  readonly semanticVersion: string;
};

export async function writeGeneratedHotWriter({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
  semanticVersion,
}: WriteGeneratedHotWriterInput): Promise<void> {
  validateGeneratedArtifactProfile({ fixtureName, symbolStem, generatedFromPath });

  const manifest = await readHotLayoutManifest(manifestPath);
  requireSafeNonNegativeInteger(
    manifest.publicationSeqOffset,
    `${manifestPath}.publicationSeqOffset`,
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
      "PUBLICATION_SEQUENCE_OFFSET",
      "CONTRACT_KEY",
      "SEMANTIC_VERSION",
      "HOT_LAYOUT_VERSION",
      "FIELD_COUNT",
      "MUTABLE_REGION_BYTE_LENGTH",
    ],
  });

  const source = renderHotWriter({
    fixtureName,
    symbolStem,
    generatedFromPath,
    manifest,
    semanticVersion,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source);
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
  readonly semanticVersion: string;
}): string {
  const fields = input.manifest.fields.map((field) => generateField(input.manifest, field));
  const snapshotTypeName = `${input.symbolStem}Snapshot`;
  const writerTypeName = `${input.symbolStem}Writer`;
  const createFunctionName = `create${input.symbolStem}Writer`;
  const validateSnapshotFunctionName = `validate${input.symbolStem}Snapshot`;
  const writeFunctionName = `write${input.symbolStem}SnapshotUnchecked`;
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
    ...renderBlockAConstants(input.manifest, input.semanticVersion),
    ...constants.map((constant) => constant.source),
    "",
    ...renderCreateWriterFunction({
      createFunctionName,
      writerTypeName,
      snapshotTypeName,
      validateSnapshotFunctionName,
      writeFunctionName,
    }),
    "",
    ...renderValidateSnapshotFunction(validateSnapshotFunctionName, snapshotTypeName, fields),
    "",
    ...renderUncheckedWriteFunction(writeFunctionName, snapshotTypeName, fields),
    "",
    ...renderHelperSources(helpers),
    ...renderCommonHelpers(helpers),
  ]);
}

function renderImports(snapshotTypeName: string): readonly string[] {
  return [
    'import { bindHotPublishRegion } from "@exclave/hot-binding";',
    'import { type HotPublishResult, publishHotRegion } from "@exclave/hot-publisher";',
    `import type { ${snapshotTypeName} } from "./hot-reader.ts";`,
  ];
}

function renderBlockAConstants(
  manifest: HotLayoutManifest,
  semanticVersion: string,
): readonly string[] {
  return [
    `const CONTRACT_KEY = ${stringLiteral(manifest.contractKey)};`,
    `const SEMANTIC_VERSION = 0x${semanticVersion}n;`,
    `const HOT_LAYOUT_VERSION = 0x${manifest.hotLayoutVersion}n;`,
    `const FIELD_COUNT = ${manifest.fields.length};`,
    `const MUTABLE_REGION_BYTE_LENGTH = ${manifest.mutableRegionByteLength};`,
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
  validateSnapshotFunctionName,
  writeFunctionName,
}: {
  readonly createFunctionName: string;
  readonly writerTypeName: string;
  readonly snapshotTypeName: string;
  readonly validateSnapshotFunctionName: string;
  readonly writeFunctionName: string;
}): readonly string[] {
  return [
    `export function ${createFunctionName}(region: Uint8Array, { instanceKey }: { instanceKey: string }): ${writerTypeName} {`,
    "  const binding = bindHotPublishRegion({",
    "    region,",
    "    seqlockOffset: SEQLOCK_OFFSET,",
    "    publicationSequenceOffset: PUBLICATION_SEQUENCE_OFFSET,",
    "    totalRegionByteLength: TOTAL_REGION_BYTE_LENGTH,",
    "    blockA: {",
    "      contractKey: CONTRACT_KEY,",
    "      instanceKey,",
    "      semanticVersion: SEMANTIC_VERSION,",
    "      hotLayoutVersion: HOT_LAYOUT_VERSION,",
    "      fieldCount: FIELD_COUNT,",
    "      mutableRegionByteLength: MUTABLE_REGION_BYTE_LENGTH,",
    "    },",
    "  });",
    "",
    "  return {",
    `    publish: (snapshot: ${snapshotTypeName}) => {`,
    `      ${validateSnapshotFunctionName}(snapshot);`,
    "      return publishHotRegion({",
    "        seqlock: binding.seqlock,",
    "        publicationSequence: binding.publicationSequence,",
    `        writeRegion: () => ${writeFunctionName}(binding.region, snapshot),`,
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
  readonly elementType: GeneratedHotScalarTypeV0;
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
  readonly elementType: GeneratedHotScalarTypeV0;
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
  readonly elementType: GeneratedHotScalarTypeV0;
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
  readonly elementType: GeneratedHotScalarTypeV0;
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

function scalarValidationHelpers(type: GeneratedHotScalarTypeV0): readonly GeneratedHelper[] {
  return [
    {
      key: scalarValidationSource(type),
      source: "",
    },
  ];
}

function scalarValidationSource(type: GeneratedHotScalarTypeV0): string {
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
  type: GeneratedHotScalarTypeV0,
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

function scalarZeroWriteSource(type: GeneratedHotScalarTypeV0, offsetSource: string): string {
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
