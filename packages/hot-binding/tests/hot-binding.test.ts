import { ExclaveError } from "@exclave/base";
import { encodeHotBlockAHeader, type HotBlockAHeaderInput } from "@exclave/hot-codec";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as hotBinding from "../src/index";
import {
  bindHotPublishRegion,
  bindHotReadRegion,
  HOT_BINDING_ERRORS,
  type HotBindingError,
  type HotBindingIssueCode,
  type HotPublishBindingInput,
  type HotReadBindingInput,
  isHotBindingError,
} from "../src/index";

function expectHotBindingError(action: () => unknown): HotBindingError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ExclaveError);
    expect(isHotBindingError(error)).toBe(true);
    expect((error as HotBindingError).code).toBe(HOT_BINDING_ERRORS.inputRejected.code);
    return error as HotBindingError;
  }

  throw new Error("expected hot binding failure");
}

const VALID_BLOCK_A: HotBlockAHeaderInput = {
  contractKey: "fixture.hotBinding",
  instanceKey: "fixture.hotBinding.instance",
  semanticVersion: 0x0102_0304_0506_0708n,
  hotLayoutVersion: 0x1112_1314_1516_1718n,
  fieldCount: 3,
  mutableRegionByteLength: 40,
};

function sharedRegionWithBlockA(input: HotBlockAHeaderInput = VALID_BLOCK_A): Uint8Array {
  const region = new Uint8Array(new SharedArrayBuffer(112));
  region.set(encodeHotBlockAHeader(input), 0);
  return region;
}

describe("@exclave/hot-binding read bindings", () => {
  it("binds a SharedArrayBuffer-backed Uint8Array region to the seqlock view", () => {
    const region = new Uint8Array(new SharedArrayBuffer(32));
    const binding = bindHotReadRegion({
      region,
      seqlockOffset: 8,
      totalRegionByteLength: 32,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock).toBeInstanceOf(BigUint64Array);
    expect(binding.seqlock.buffer).toBe(region.buffer);
    expect(binding.seqlock.byteOffset).toBe(region.byteOffset + 8);
    expect(binding.seqlock.length).toBe(1);
  });

  it("validates matching Block A bytes before binding read counters", () => {
    const region = sharedRegionWithBlockA();
    const binding = bindHotReadRegion({
      region,
      seqlockOffset: 72,
      totalRegionByteLength: 112,
      blockA: VALID_BLOCK_A,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock.byteOffset).toBe(region.byteOffset + 72);
  });

  it("binds read counters with a non-zero region byteOffset", () => {
    const region = new Uint8Array(new SharedArrayBuffer(48), 8, 32);
    const binding = bindHotReadRegion({
      region,
      seqlockOffset: 8,
      totalRegionByteLength: 32,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock.byteOffset).toBe(16);
  });
});

describe("@exclave/hot-binding publish bindings", () => {
  it("binds seqlock and publicationSequence counter views over the same hot region", () => {
    const region = new Uint8Array(new SharedArrayBuffer(32));
    const binding = bindHotPublishRegion({
      region,
      seqlockOffset: 8,
      publicationSequenceOffset: 16,
      totalRegionByteLength: 32,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock.buffer).toBe(region.buffer);
    expect(binding.seqlock.byteOffset).toBe(region.byteOffset + 8);
    expect(binding.seqlock.length).toBe(1);
    expect(binding.publicationSequence.buffer).toBe(region.buffer);
    expect(binding.publicationSequence.byteOffset).toBe(region.byteOffset + 16);
    expect(binding.publicationSequence.length).toBe(1);
  });

  it("validates matching Block A bytes before binding publish counters", () => {
    const region = sharedRegionWithBlockA();
    const binding = bindHotPublishRegion({
      region,
      seqlockOffset: 72,
      publicationSequenceOffset: 88,
      totalRegionByteLength: 112,
      blockA: VALID_BLOCK_A,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock.byteOffset).toBe(region.byteOffset + 72);
    expect(binding.publicationSequence.byteOffset).toBe(region.byteOffset + 88);
  });

  it("binds publish counters with a non-zero region byteOffset", () => {
    const region = new Uint8Array(new SharedArrayBuffer(56), 8, 40);
    const binding = bindHotPublishRegion({
      region,
      seqlockOffset: 8,
      publicationSequenceOffset: 24,
      totalRegionByteLength: 40,
    });

    expect(binding.region).toBe(region);
    expect(binding.seqlock.byteOffset).toBe(16);
    expect(binding.publicationSequence.byteOffset).toBe(32);
  });
});

describe("@exclave/hot-binding input errors", () => {
  it("rejects non-object input", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion(null as unknown as HotReadBindingInput),
    );

    expect(error.details.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["input.requestInvalid", "input"],
    ]);
  });

  it("rejects array input", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion([] as unknown as HotReadBindingInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.requestInvalid"]);
  });

  it("rejects non-Uint8Array regions", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new DataView(new SharedArrayBuffer(16)),
        seqlockOffset: 0,
        totalRegionByteLength: 16,
      } as unknown as HotReadBindingInput),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.regionViewInvalid"]);
  });

  it("rejects regions not backed by SharedArrayBuffer", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new ArrayBuffer(16)),
        seqlockOffset: 0,
        totalRegionByteLength: 16,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.regionBufferNotShared",
    ]);
  });

  it("rejects too-short regions", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new SharedArrayBuffer(8)),
        seqlockOffset: 0,
        totalRegionByteLength: 16,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.regionViewTooShort"]);
  });

  it("rejects invalid totalRegionByteLength values", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new SharedArrayBuffer(16)),
        seqlockOffset: 0,
        totalRegionByteLength: 0,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.totalRegionByteLengthInvalid",
    ]);
  });

  it("rejects invalid seqlockOffset values", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new SharedArrayBuffer(16)),
        seqlockOffset: -1,
        totalRegionByteLength: 16,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual(["input.seqlockOffsetInvalid"]);
  });

  it("rejects seqlockOffset byte ranges outside totalRegionByteLength", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new SharedArrayBuffer(16)),
        seqlockOffset: 16,
        totalRegionByteLength: 16,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.seqlockOffsetOutOfRange",
    ]);
  });

  it("rejects misaligned seqlock offsets", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region: new Uint8Array(new SharedArrayBuffer(16)),
        seqlockOffset: 4,
        totalRegionByteLength: 16,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.seqlockOffsetMisaligned",
    ]);
  });

  it("rejects invalid publicationSequenceOffset values for publish binding", () => {
    const error = expectHotBindingError(() =>
      bindHotPublishRegion({
        region: new Uint8Array(new SharedArrayBuffer(24)),
        seqlockOffset: 0,
        publicationSequenceOffset: -1,
        totalRegionByteLength: 24,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceOffsetInvalid",
    ]);
  });

  it("rejects publicationSequenceOffset byte ranges outside totalRegionByteLength", () => {
    const error = expectHotBindingError(() =>
      bindHotPublishRegion({
        region: new Uint8Array(new SharedArrayBuffer(24)),
        seqlockOffset: 0,
        publicationSequenceOffset: 24,
        totalRegionByteLength: 24,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceOffsetOutOfRange",
    ]);
  });

  it("rejects misaligned publicationSequence offsets", () => {
    const error = expectHotBindingError(() =>
      bindHotPublishRegion({
        region: new Uint8Array(new SharedArrayBuffer(24)),
        seqlockOffset: 0,
        publicationSequenceOffset: 12,
        totalRegionByteLength: 24,
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toEqual([
      "input.publicationSequenceOffsetMisaligned",
    ]);
  });

  it("rejects overlapping seqlock and publicationSequence counter slots", () => {
    const error = expectHotBindingError(() =>
      bindHotPublishRegion({
        region: new Uint8Array(new SharedArrayBuffer(24)),
        seqlockOffset: 8,
        publicationSequenceOffset: 8,
        totalRegionByteLength: 24,
      }),
    );

    expect(error.details.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["input.counterViewsOverlap", "input.publicationSequenceOffset"],
    ]);
  });

  it("collects and sorts multiple validation issues by path and code", () => {
    const error = expectHotBindingError(() =>
      bindHotPublishRegion({
        region: new Uint8Array(new ArrayBuffer(0)),
        seqlockOffset: -1,
        publicationSequenceOffset: "bad",
        totalRegionByteLength: 0,
      } as unknown as HotPublishBindingInput),
    );

    expect(error.details.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["input.publicationSequenceOffsetInvalid", "input.publicationSequenceOffset"],
      ["input.regionBufferNotShared", "input.region"],
      ["input.seqlockOffsetInvalid", "input.seqlockOffset"],
      ["input.totalRegionByteLengthInvalid", "input.totalRegionByteLength"],
    ]);
  });

  it.each([
    {
      name: "wrong magic",
      mutate: (region: Uint8Array) => region.set([0xde, 0xad, 0xbe, 0xef], 0),
      expectedDetail: "header.magicInvalid",
    },
    {
      name: "wrong hotAbiVersion",
      mutate: (region: Uint8Array) => new DataView(region.buffer).setUint32(4, 2, true),
      expectedDetail: "header.hotAbiVersionUnsupported",
    },
    {
      name: "wrong contractKeyHash",
      mutate: (region: Uint8Array) => region.fill(0, 8, 24),
      expectedDetail: "header.contractKeyHashMismatch",
    },
    {
      name: "wrong instanceKeyHash",
      mutate: (region: Uint8Array) => region.fill(0, 24, 40),
      expectedDetail: "header.instanceKeyHashMismatch",
    },
    {
      name: "wrong semanticVersion",
      mutate: (region: Uint8Array) => new DataView(region.buffer).setBigUint64(40, 0n, true),
      expectedDetail: "header.semanticVersionMismatch",
    },
    {
      name: "wrong hotLayoutVersion",
      mutate: (region: Uint8Array) => new DataView(region.buffer).setBigUint64(48, 0n, true),
      expectedDetail: "header.hotLayoutVersionMismatch",
    },
    {
      name: "wrong fieldCount",
      mutate: (region: Uint8Array) => new DataView(region.buffer).setUint32(56, 99, true),
      expectedDetail: "header.fieldCountMismatch",
    },
    {
      name: "wrong mutable length",
      mutate: (region: Uint8Array) => new DataView(region.buffer).setUint32(60, 99, true),
      expectedDetail: "header.mutableRegionByteLengthMismatch",
    },
    {
      name: "non-zero reserved bytes",
      mutate: (region: Uint8Array) => {
        region[64] = 0xff;
      },
      expectedDetail: "header.reservedNonZero",
    },
  ])("rejects Block A with $name", ({ mutate, expectedDetail }) => {
    const region = sharedRegionWithBlockA();
    mutate(region);

    const error = expectHotBindingError(() =>
      bindHotReadRegion({
        region,
        seqlockOffset: 72,
        totalRegionByteLength: 112,
        blockA: VALID_BLOCK_A,
      }),
    );

    expect(error.details.issues).toEqual([
      expect.objectContaining({
        code: "input.blockAHeaderInvalid",
        detail: expect.stringContaining(expectedDetail),
      }),
    ]);
  });
});

describe("@exclave/hot-binding public error surface", () => {
  it("keeps HotBindingError type-only while exporting descriptor, creator, and predicate helpers", () => {
    const error = expectHotBindingError(() =>
      bindHotReadRegion(null as unknown as HotReadBindingInput),
    );

    expect("HotBindingError" in hotBinding).toBe(false);
    expect(HOT_BINDING_ERRORS.inputRejected.code).toBe("hotBinding.inputRejected");
    expect(typeof hotBinding.createHotBindingInputRejectedError).toBe("function");
    expect(typeof hotBinding.isHotBindingError).toBe("function");
    expect(isHotBindingError(error)).toBe(true);
    expectTypeOf<HotBindingError>().toMatchTypeOf<ExclaveError<"hotBinding.inputRejected">>();
  });

  it("exports the intended issue code surface", () => {
    expectTypeOf<HotBindingIssueCode>().toEqualTypeOf<
      | "input.requestInvalid"
      | "input.regionViewInvalid"
      | "input.regionBufferNotShared"
      | "input.regionViewTooShort"
      | "input.totalRegionByteLengthInvalid"
      | "input.seqlockOffsetInvalid"
      | "input.seqlockOffsetOutOfRange"
      | "input.seqlockOffsetMisaligned"
      | "input.publicationSequenceOffsetInvalid"
      | "input.publicationSequenceOffsetOutOfRange"
      | "input.publicationSequenceOffsetMisaligned"
      | "input.counterViewsOverlap"
      | "input.blockAHeaderInvalid"
    >();
  });
});
