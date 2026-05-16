import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { toConstantStem, toPascalCase } from "./generated-hot/identifiers.mts";
import {
  type HotFieldEntry,
  type HotLayoutManifest,
  readHotLayoutManifest,
  requireByteSpan,
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
  readonly offsetConstant: string;
  readonly typeSource: string;
  readonly readSource: string;
  readonly constants: readonly GeneratedConstant[];
  readonly helpers: readonly GeneratedHelper[];
};

type WriteGeneratedHotReaderInput = {
  readonly fixtureName: string;
  readonly symbolStem: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

export async function writeGeneratedHotReader({
  fixtureName,
  symbolStem,
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotReaderInput): Promise<void> {
  validateGeneratedArtifactProfile({ fixtureName, symbolStem, generatedFromPath });

  const manifest = await readHotLayoutManifest(manifestPath);
  validateHotLayoutManifest(manifest, manifestPath, {
    getGeneratedConstantNames: generatedConstantNamesFor,
  });

  const source = renderHotReader({
    fixtureName,
    symbolStem,
    generatedFromPath,
    manifest,
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
  const fieldsFunctionName = `read${input.symbolStem}Fields`;
  const validateFunctionName = `validate${input.symbolStem}Region`;
  const constants = collectGeneratedConstants(fields);
  const helpers = collectGeneratedHelpers(
    fields,
    new Set([readFunctionName, createFunctionName, fieldsFunctionName, validateFunctionName]),
  );

  return withFinalNewline([
    `// Generated from ${input.generatedFromPath}. Do not edit by hand.`,
    "",
    ...renderImports(),
    "",
    ...renderSnapshotType(snapshotTypeName, fields),
    "",
    ...renderReaderType(readerTypeName, snapshotTypeName),
    "",
    `const SEQLOCK_OFFSET = ${input.manifest.seqlockOffset};`,
    `const TOTAL_REGION_BYTE_LENGTH = ${input.manifest.totalRegionByteLength};`,
    ...constants.map((constant) => constant.source),
    "const U64_BYTE_ALIGNMENT = BigUint64Array.BYTES_PER_ELEMENT;",
    "",
    ...renderUncheckedReadFunction(readFunctionName, fieldsFunctionName, snapshotTypeName),
    "",
    ...renderCreateReaderFunction({
      createFunctionName,
      readFunctionName,
      readerTypeName,
      snapshotTypeName,
      validateFunctionName,
    }),
    "",
    ...renderFieldsFunction(fieldsFunctionName, snapshotTypeName, fields),
    "",
    ...renderHelperSources(helpers),
    ...renderValidateFunction(input.fixtureName, validateFunctionName),
  ]);
}

function renderImports(): readonly string[] {
  return [
    "import {",
    "  createHotReadState,",
    "  type HotReadAttemptResult,",
    "  type HotReadOptions,",
    "  type HotReadState,",
    "  tryReadHotSnapshot,",
    '} from "@exclave/hot-consumer";',
  ];
}

function renderSnapshotType(
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `export type ${snapshotTypeName} = {`,
    ...fields.map((field) => `  readonly ${field.name}: ${field.typeSource};`),
    "};",
  ];
}

function renderReaderType(readerTypeName: string, snapshotTypeName: string): readonly string[] {
  return [
    `export type ${readerTypeName} = {`,
    `  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<${snapshotTypeName}>;`,
    "};",
  ];
}

function renderUncheckedReadFunction(
  readFunctionName: string,
  fieldsFunctionName: string,
  snapshotTypeName: string,
): readonly string[] {
  return [
    `export function ${readFunctionName}(region: Uint8Array): ${snapshotTypeName} {`,
    "  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);",
    `  return ${fieldsFunctionName}(view);`,
    "}",
  ];
}

function renderCreateReaderFunction({
  createFunctionName,
  readFunctionName,
  readerTypeName,
  snapshotTypeName,
  validateFunctionName,
}: {
  readonly createFunctionName: string;
  readonly readFunctionName: string;
  readonly readerTypeName: string;
  readonly snapshotTypeName: string;
  readonly validateFunctionName: string;
}): readonly string[] {
  return [
    `export function ${createFunctionName}(region: Uint8Array): ${readerTypeName} {`,
    `  ${validateFunctionName}(region);`,
    "",
    "  const sequence = new BigUint64Array(region.buffer, region.byteOffset + SEQLOCK_OFFSET, 1);",
    `  const state: HotReadState<${snapshotTypeName}> = createHotReadState<${snapshotTypeName}>();`,
    "",
    "  return {",
    "    tryRead: (options?: HotReadOptions) =>",
    "      tryReadHotSnapshot({",
    "        sequence,",
    `        readCandidate: () => ${readFunctionName}(region),`,
    "        state,",
    "        options,",
    "      }),",
    "  };",
    "}",
  ];
}

function renderFieldsFunction(
  fieldsFunctionName: string,
  snapshotTypeName: string,
  fields: readonly GeneratedField[],
): readonly string[] {
  return [
    `function ${fieldsFunctionName}(view: DataView): ${snapshotTypeName} {`,
    "  return {",
    ...fields.map((field) => `    ${field.name}: ${field.readSource},`),
    "  };",
    "}",
  ];
}

function renderHelperSources(helpers: readonly GeneratedHelper[]): readonly string[] {
  if (helpers.length === 0) {
    return [];
  }

  return [...joinBlocks(helpers.map((helper) => helper.source.split("\n"))), ""];
}

function renderValidateFunction(
  fixtureName: string,
  validateFunctionName: string,
): readonly string[] {
  return [
    `function ${validateFunctionName}(region: Uint8Array): void {`,
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
    "}",
  ];
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

    case "FixedEnum": {
      const variantsSource = field.shape.variants
        .map((variant) => stringLiteral(variant))
        .join(", ");
      const typeSource = field.shape.variants.map((variant) => stringLiteral(variant)).join(" | ");
      const variantsConstant = `${toConstantStem(field.dotPath)}_VARIANTS`;

      requireByteSpan(field, 1);
      return {
        ...base,
        typeSource,
        readSource: `read${symbol}(view)`,
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
            key: `read${symbol}`,
            source: renderFixedEnumHelper({
              discriminantOffsetConstant: offsetConstant,
              dotPath: field.dotPath,
              functionName: `read${symbol}`,
              typeSource,
              variantsConstant,
            }),
          },
        ],
      };
    }

    case "FixedStringEncoded": {
      const byteLengthConstant = `${toConstantStem(field.dotPath)}_BYTE_LENGTH`;

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
            name: byteLengthConstant,
            source: `const ${byteLengthConstant} = ${field.shape.byteLength};`,
          },
        ],
        helpers: [
          {
            key: `read${symbol}`,
            source: renderFixedStringHelper({
              byteLengthConstant,
              dotPath: field.dotPath,
              functionName: `read${symbol}`,
              offsetConstant,
            }),
          },
        ],
      };
    }

    case "FixedVector": {
      const shape = field.shape;
      const unitByteLength = scalarByteWidth(shape.elementType);
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

      requireByteSpan(field, shape.length * unitByteLength);
      return {
        ...base,
        typeSource: `readonly [${Array.from({ length: shape.length }, () =>
          scalarTypeSource(shape.elementType),
        ).join(", ")}]`,
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
        ...base,
        typeSource: `readonly ${scalarTypeSource(shape.elementType)}[]`,
        readSource: `read${symbol}(view)`,
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
            key: `read${symbol}`,
            source: renderBoundedArrayHelper({
              dotPath: field.dotPath,
              elementType: shape.elementType,
              elementsOffsetConstant,
              functionName: `read${symbol}`,
              maxCountConstant,
              unitByteLengthConstant,
              countOffsetConstant,
            }),
          },
          ...scalarHelpers(shape.elementType),
        ],
      };
    }

    default:
      return assertNever(field.shape, `${field.dotPath} shape is not supported`);
  }
}

function renderFixedEnumHelper({
  discriminantOffsetConstant,
  dotPath,
  functionName,
  typeSource,
  variantsConstant,
}: {
  readonly discriminantOffsetConstant: string;
  readonly dotPath: string;
  readonly functionName: string;
  readonly typeSource: string;
  readonly variantsConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(view: DataView): ${typeSource} {`,
    `  const discriminant = view.getUint8(${discriminantOffsetConstant});`,
    `  const value = ${variantsConstant}[discriminant];`,
    "  if (value === undefined) {",
    `    throw new RangeError(${stringLiteral(`${dotPath} enum discriminant is outside variants`)});`,
    "  }",
    "  return value;",
    "}",
  ]);
}

function renderFixedStringHelper({
  byteLengthConstant,
  dotPath,
  functionName,
  offsetConstant,
}: {
  readonly byteLengthConstant: string;
  readonly dotPath: string;
  readonly functionName: string;
  readonly offsetConstant: string;
}): string {
  return joinLines([
    `function ${functionName}(view: DataView): string {`,
    '  let value = "";',
    `  for (let offset = ${offsetConstant}; offset < ${offsetConstant} + ${byteLengthConstant}; offset += 1) {`,
    "    const byte = view.getUint8(offset);",
    "    if (byte === 0) {",
    "      break;",
    "    }",
    "    if (byte > 0x7f) {",
    `      throw new RangeError(${stringLiteral(`${dotPath} contains a non-ascii byte`)});`,
    "    }",
    "    value += String.fromCharCode(byte);",
    "  }",
    "  return value;",
    "}",
  ]);
}

function renderBoundedArrayHelper({
  countOffsetConstant,
  dotPath,
  elementType,
  elementsOffsetConstant,
  functionName,
  maxCountConstant,
  unitByteLengthConstant,
}: {
  readonly countOffsetConstant: string;
  readonly dotPath: string;
  readonly elementType: GeneratedHotScalarTypeV0;
  readonly elementsOffsetConstant: string;
  readonly functionName: string;
  readonly maxCountConstant: string;
  readonly unitByteLengthConstant: string;
}): string {
  const elementTsType = scalarTypeSource(elementType);
  const elementOffset = `${elementsOffsetConstant} + index * ${unitByteLengthConstant}`;

  return joinLines([
    `function ${functionName}(view: DataView): readonly ${elementTsType}[] {`,
    `  const count = view.getUint32(${countOffsetConstant}, true);`,
    `  if (count > ${maxCountConstant}) {`,
    `    throw new RangeError(${stringLiteral(`${dotPath} bounded array count exceeds maxCount`)});`,
    "  }",
    "",
    `  const values: ${elementTsType}[] = [];`,
    "  for (let index = 0; index < count; index += 1) {",
    `    values.push(${scalarReadSource(elementType, elementOffset, dotPath)});`,
    "  }",
    "  return values;",
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
        throw new Error(`generated reader constant ${constant.name} is duplicated`);
      }
      names.add(constant.name);
      constants.push(constant);
    }
  }

  return constants;
}

function collectGeneratedHelpers(
  fields: readonly GeneratedField[],
  reservedFunctionNames: ReadonlySet<string>,
): readonly GeneratedHelper[] {
  const helpers = new Map<string, GeneratedHelper>();

  for (const field of fields) {
    for (const helper of field.helpers) {
      if (reservedFunctionNames.has(helper.key)) {
        throw new Error(`generated reader helper ${helper.key} collides with an internal function`);
      }

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
  type: GeneratedHotScalarTypeV0,
  offsetSource: string,
  fieldName: string,
): string {
  switch (type) {
    case "bool":
      return `readBoolean(view, ${offsetSource}, ${stringLiteral(fieldName)})`;
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

function scalarHelpers(type: GeneratedHotScalarTypeV0): readonly GeneratedHelper[] {
  switch (type) {
    case "bool":
      return [
        {
          key: "readBoolean",
          source: renderBooleanHelper(),
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

function renderBooleanHelper(): string {
  return joinLines([
    "function readBoolean(view: DataView, offset: number, fieldName: string): boolean {",
    "  const value = view.getUint8(offset);",
    "  if (value === 0) {",
    "    return false;",
    "  }",
    "  if (value === 1) {",
    "    return true;",
    "  }",
    `  throw new RangeError(\`\${fieldName} bool byte must be 0 or 1\`);`,
    "}",
  ]);
}
