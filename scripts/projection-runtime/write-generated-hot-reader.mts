import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type HotExchangeFieldPath = "displayName" | "gain" | "levelVector" | "phase" | "revision";

type HotExchangeFieldEntry = {
  readonly dotPath: HotExchangeFieldPath;
  readonly absoluteOffset: number;
  readonly byteSpan: number;
  readonly shape: Record<string, unknown>;
};

type HotExchangeLayoutManifest = {
  readonly seqlockOffset: number;
  readonly totalRegionByteLength: number;
  readonly fields: readonly HotExchangeFieldEntry[];
};

type HotExchangeGeneratedConstants = {
  readonly seqlockOffset: number;
  readonly totalRegionByteLength: number;
  readonly displayNameOffset: number;
  readonly displayNameByteLength: number;
  readonly gainOffset: number;
  readonly levelVectorOffset: number;
  readonly levelVectorElementOffsets: readonly [number, number, number, number];
  readonly phaseOffset: number;
  readonly revisionOffset: number;
};

type WriteGeneratedHotExchangeReaderInput = {
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly generatedFromPath: string;
};

export async function writeGeneratedHotExchangeReader({
  manifestPath,
  outputPath,
  generatedFromPath,
}: WriteGeneratedHotExchangeReaderInput): Promise<void> {
  const manifest = await readHotExchangeLayoutManifest(manifestPath);
  const constants = deriveHotExchangeConstants(manifest);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderHotExchangeReader(generatedFromPath, constants));
}

async function readHotExchangeLayoutManifest(path: string): Promise<HotExchangeLayoutManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain an object manifest`);
  }

  const seqlockOffset = parsed.seqlockOffset;
  const totalRegionByteLength = parsed.totalRegionByteLength;
  const fields = parsed.fields;

  if (
    typeof seqlockOffset !== "number" ||
    typeof totalRegionByteLength !== "number" ||
    !Array.isArray(fields)
  ) {
    throw new Error(`${path} is not a hot-exchange-v0 hot layout manifest`);
  }

  return {
    seqlockOffset,
    totalRegionByteLength,
    fields: fields.map((field, index) => readHotExchangeField(field, path, index)),
  };
}

function readHotExchangeField(value: unknown, path: string, index: number): HotExchangeFieldEntry {
  if (!isRecord(value)) {
    throw new Error(`${path}.fields.${index} must be an object`);
  }

  const dotPath = value.dotPath;
  const absoluteOffset = value.absoluteOffset;
  const byteSpan = value.byteSpan;
  const shape = value.shape;

  if (!isHotExchangeFieldPath(dotPath)) {
    throw new Error(`${path}.fields.${index}.dotPath is not supported by this proof generator`);
  }

  if (typeof absoluteOffset !== "number" || typeof byteSpan !== "number" || !isRecord(shape)) {
    throw new Error(`${path}.fields.${index} is missing required layout data`);
  }

  return {
    dotPath,
    absoluteOffset,
    byteSpan,
    shape,
  };
}

function deriveHotExchangeConstants(
  manifest: HotExchangeLayoutManifest,
): HotExchangeGeneratedConstants {
  const displayName = requireField(manifest, "displayName");
  const gain = requireField(manifest, "gain");
  const levelVector = requireField(manifest, "levelVector");
  const phase = requireField(manifest, "phase");
  const revision = requireField(manifest, "revision");

  requireFixedString(displayName, 16, "ascii");
  requireFixedScalar(gain, "f32");
  requireFixedVector(levelVector, "f32", 4);
  requireFixedScalar(phase, "f64");
  requireFixedScalar(revision, "u32");

  return {
    seqlockOffset: manifest.seqlockOffset,
    totalRegionByteLength: manifest.totalRegionByteLength,
    displayNameOffset: displayName.absoluteOffset,
    displayNameByteLength: displayName.byteSpan,
    gainOffset: gain.absoluteOffset,
    levelVectorOffset: levelVector.absoluteOffset,
    levelVectorElementOffsets: [
      levelVector.absoluteOffset,
      levelVector.absoluteOffset + 4,
      levelVector.absoluteOffset + 8,
      levelVector.absoluteOffset + 12,
    ],
    phaseOffset: phase.absoluteOffset,
    revisionOffset: revision.absoluteOffset,
  };
}

function requireField(
  manifest: HotExchangeLayoutManifest,
  dotPath: HotExchangeFieldPath,
): HotExchangeFieldEntry {
  const matches = manifest.fields.filter((field) => field.dotPath === dotPath);

  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`hot-exchange-v0 manifest must contain exactly one ${dotPath} field`);
  }

  return matches[0];
}

function requireFixedString(
  field: HotExchangeFieldEntry,
  byteLength: number,
  encoding: string,
): void {
  if (
    field.shape.kind !== "FixedStringEncoded" ||
    field.shape.byteLength !== byteLength ||
    field.shape.encoding !== encoding ||
    field.byteSpan !== byteLength
  ) {
    throw new Error(`hot-exchange-v0 ${field.dotPath} field shape changed`);
  }
}

function requireFixedScalar(field: HotExchangeFieldEntry, type: string): void {
  if (field.shape.kind !== "FixedScalar" || field.shape.type !== type) {
    throw new Error(`hot-exchange-v0 ${field.dotPath} field shape changed`);
  }
}

function requireFixedVector(
  field: HotExchangeFieldEntry,
  elementType: string,
  length: number,
): void {
  if (
    field.shape.kind !== "FixedVector" ||
    field.shape.elementType !== elementType ||
    field.shape.length !== length
  ) {
    throw new Error(`hot-exchange-v0 ${field.dotPath} field shape changed`);
  }
}

function renderHotExchangeReader(
  generatedFromPath: string,
  constants: HotExchangeGeneratedConstants,
): string {
  return `// Generated from ${generatedFromPath}. Do not edit by hand.

import {
  createHotReadState,
  type HotReadAttemptResult,
  type HotReadOptions,
  type HotReadState,
  tryReadHotSnapshot,
} from "@exclave/hot-consumer";

export type HotExchangeSnapshot = {
  readonly displayName: string;
  readonly gain: number;
  readonly levelVector: readonly [number, number, number, number];
  readonly phase: number;
  readonly revision: number;
};

export type HotExchangeReader = {
  readonly tryRead: (options?: HotReadOptions) => HotReadAttemptResult<HotExchangeSnapshot>;
};

const SEQLOCK_OFFSET = ${constants.seqlockOffset};
const TOTAL_REGION_BYTE_LENGTH = ${constants.totalRegionByteLength};
const DISPLAY_NAME_OFFSET = ${constants.displayNameOffset};
const DISPLAY_NAME_BYTE_LENGTH = ${constants.displayNameByteLength};
const GAIN_OFFSET = ${constants.gainOffset};
const LEVEL_VECTOR_OFFSET = ${constants.levelVectorOffset};
const LEVEL_VECTOR_0_OFFSET = LEVEL_VECTOR_OFFSET;
const LEVEL_VECTOR_1_OFFSET = ${constants.levelVectorElementOffsets[1]};
const LEVEL_VECTOR_2_OFFSET = ${constants.levelVectorElementOffsets[2]};
const LEVEL_VECTOR_3_OFFSET = ${constants.levelVectorElementOffsets[3]};
const PHASE_OFFSET = ${constants.phaseOffset};
const REVISION_OFFSET = ${constants.revisionOffset};
const U64_BYTE_ALIGNMENT = BigUint64Array.BYTES_PER_ELEMENT;

export function readHotExchangeSnapshotUnchecked(region: Uint8Array): HotExchangeSnapshot {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  return readHotExchangeFields(view);
}

export function createHotExchangeReader(region: Uint8Array): HotExchangeReader {
  validateHotExchangeRegion(region);

  const sequence = new BigUint64Array(region.buffer, region.byteOffset + SEQLOCK_OFFSET, 1);
  const state: HotReadState<HotExchangeSnapshot> = createHotReadState<HotExchangeSnapshot>();

  return {
    tryRead: (options?: HotReadOptions) =>
      tryReadHotSnapshot({
        sequence,
        readCandidate: () => readHotExchangeSnapshotUnchecked(region),
        state,
        options,
      }),
  };
}

function readHotExchangeFields(view: DataView): HotExchangeSnapshot {
  return {
    displayName: readDisplayName(view),
    gain: view.getFloat32(GAIN_OFFSET, true),
    levelVector: [
      view.getFloat32(LEVEL_VECTOR_0_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_1_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_2_OFFSET, true),
      view.getFloat32(LEVEL_VECTOR_3_OFFSET, true),
    ],
    phase: view.getFloat64(PHASE_OFFSET, true),
    revision: view.getUint32(REVISION_OFFSET, true),
  };
}

function readDisplayName(view: DataView): string {
  let value = "";
  for (let offset = DISPLAY_NAME_OFFSET; offset < DISPLAY_NAME_OFFSET + DISPLAY_NAME_BYTE_LENGTH; offset += 1) {
    const byte = view.getUint8(offset);
    if (byte === 0) {
      break;
    }
    if (byte > 0x7f) {
      throw new RangeError("displayName contains a non-ascii byte");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function validateHotExchangeRegion(region: Uint8Array): void {
  if (!(region instanceof Uint8Array)) {
    throw new TypeError("hot-exchange region must be a Uint8Array");
  }

  if (!(region.buffer instanceof SharedArrayBuffer)) {
    throw new TypeError("hot-exchange region must be backed by SharedArrayBuffer");
  }

  if (region.byteLength < TOTAL_REGION_BYTE_LENGTH) {
    throw new RangeError(\`hot-exchange region must be at least \${TOTAL_REGION_BYTE_LENGTH} bytes\`);
  }

  const absoluteSeqlockOffset = region.byteOffset + SEQLOCK_OFFSET;
  if (absoluteSeqlockOffset % U64_BYTE_ALIGNMENT !== 0) {
    throw new RangeError("hot-exchange seqlock view is not u64-aligned");
  }
}
`;
}

function isHotExchangeFieldPath(value: unknown): value is HotExchangeFieldPath {
  return (
    value === "displayName" ||
    value === "gain" ||
    value === "levelVector" ||
    value === "phase" ||
    value === "revision"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
