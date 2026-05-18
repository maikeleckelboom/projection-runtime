import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ExclaveError } from "@exclave/base";
import { type AuthoredProjectionContract, SchemaValidationError } from "@exclave/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compileAuthoredProjectionContractWithOptions } from "../src/compile";
import * as compiler from "../src/index";
import {
  buildProjectionFieldIdentityMirror,
  type CanonicalFieldShape,
  type CompileProjectionResult,
  type CompileProjectionSuccess,
  type CompilerError,
  compileAuthoredProjectionContract,
  deriveProjectionFieldIdentityArtifact,
  deriveProjectionFieldIdentityArtifactFromManifest,
  emitTypeScriptFieldIdentityModule,
  type ResolvedProjectionContract,
} from "../src/index";
import { deriveSemanticVersion } from "../src/version";

function unwrap(result: CompileProjectionResult): ResolvedProjectionContract {
  expect(result.ok).toBe(true);
  return (result as CompileProjectionSuccess).value;
}

function expectFailure(result: CompileProjectionResult): CompilerError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected compiler failure");
  }

  return result.error;
}

function unwrapHotManifest(
  resolved: ResolvedProjectionContract,
): NonNullable<NonNullable<ResolvedProjectionContract["laneManifests"]>["hot"]> {
  const hotManifest = resolved.laneManifests?.hot;
  expect(hotManifest).toBeDefined();
  if (hotManifest === undefined) {
    throw new Error("expected hot lane manifest");
  }

  return hotManifest;
}

function unwrapWarmManifest(
  resolved: ResolvedProjectionContract,
): NonNullable<NonNullable<ResolvedProjectionContract["laneManifests"]>["warm"]> {
  const warmManifest = resolved.laneManifests?.warm;
  expect(warmManifest).toBeDefined();
  if (warmManifest === undefined) {
    throw new Error("expected warm lane manifest");
  }

  return warmManifest;
}

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hotBasicFixtureRoot = resolve(repoRoot, "fixtures/projection-runtime/hot-basic-v0");

function readFixtureJson(fileName: string): unknown {
  return JSON.parse(readFileSync(resolve(hotBasicFixtureRoot, fileName), "utf8"));
}

function stableFixtureJson(value: unknown): string {
  return `${JSON.stringify(toFixtureJson(value), null, 2)}\n`;
}

function toFixtureJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return encodeU64Hex(value);
  }

  if (Array.isArray(value)) {
    return value.map(toFixtureJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, toFixtureJson(nested)]),
    );
  }

  return value;
}

function encodeU64Hex(value: bigint): string {
  expect(value).toBeGreaterThanOrEqual(0n);
  expect(value).toBeLessThanOrEqual(0xffff_ffff_ffff_ffffn);
  return value.toString(16).padStart(16, "0");
}

function hotLayoutFixture(overrides: Partial<AuthoredProjectionContract> = {}) {
  return {
    key: "fixture.hot",
    family: "replaceable-snapshot",
    fields: {
      cursor: { kind: "fixed-scalar", type: "u8" },
      tempo: { kind: "fixed-scalar", type: "f64" },
      phase: { kind: "fixed-scalar", type: "f64" },
      flags: { kind: "fixed-string-encoded", byteLength: 3, encoding: "ascii" },
      peaks: { kind: "bounded-array", elementType: "f32", maxLength: 3 },
      meters: { kind: "fixed-vector", elementType: "f32", length: 2 },
      lookup: {
        kind: "bounded-map",
        keyEncoding: "fixed-ascii",
        keyByteLength: 4,
        valueShape: { kind: "fixed-scalar", type: "f32" },
        maxEntries: 2,
      },
    },
    lanes: {
      hot: {
        reservations: ["lookup", "peaks"],
      },
    },
    ...overrides,
  } satisfies AuthoredProjectionContract;
}

function warmIdentityFixture(overrides: Partial<AuthoredProjectionContract> = {}) {
  return {
    key: "fixture.warm",
    family: "replaceable-snapshot",
    fields: {
      zed: { kind: "variable-string" },
      transport: {
        tempo: { kind: "fixed-scalar", type: "f64" },
        phase: { kind: "fixed-scalar", type: "f64" },
      },
      flags: { kind: "fixed-string-encoded", byteLength: 3, encoding: "ascii" },
    },
    lanes: {
      warm: {},
    },
    ...overrides,
  } satisfies AuthoredProjectionContract;
}

function warmHotIdentityFixture(overrides: Partial<AuthoredProjectionContract> = {}) {
  return {
    key: "fixture.warmHot",
    family: "replaceable-snapshot",
    fields: {
      tempo: { kind: "fixed-scalar", type: "f64" },
      samples: { kind: "bounded-array", elementType: "f32", maxLength: 8 },
    },
    lanes: {
      warm: {},
    },
    ...overrides,
  } satisfies AuthoredProjectionContract;
}

const fieldIdentityIds = new Map([
  ["peaks.postFader.left", 101],
  ["peaks.postFader.right", 102],
  ["transport.phase", 201],
  ["transport.tempo", 202],
]);

function fieldIdentityFixture(overrides: Partial<AuthoredProjectionContract> = {}) {
  return {
    key: "deck.runtime",
    family: "replaceable-snapshot",
    fields: {
      transport: {
        tempo: { kind: "fixed-scalar", type: "f64" },
        phase: { kind: "fixed-scalar", type: "f64" },
      },
      peaks: {
        postFader: {
          right: { kind: "fixed-scalar", type: "f32" },
          left: { kind: "fixed-scalar", type: "f32" },
        },
      },
    },
    lanes: {
      hot: {},
    },
    ...overrides,
  } satisfies AuthoredProjectionContract;
}

function compileFieldIdentityFixture(
  contract: AuthoredProjectionContract = fieldIdentityFixture(),
): ResolvedProjectionContract {
  return unwrap(
    compileAuthoredProjectionContractWithOptions(contract, {
      fieldIdDeriver: (_contractKey, dotPath) => {
        const fieldId = fieldIdentityIds.get(dotPath);
        if (fieldId === undefined) {
          throw new Error(`missing test field id for ${dotPath}`);
        }

        return fieldId;
      },
    }),
  );
}

describe("@exclave/compiler happy path", () => {
  it("compiles a minimal authored projection contract", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );

    expect(resolved.manifest.key).toBe("deck.runtime");
    expect(resolved.manifest.fields).toHaveLength(1);
    expect(resolved.manifest.fields[0]).toMatchObject({
      dotPath: "tempo",
      shape: { kind: "FixedScalar", type: "f64" },
    });
    expectTypeOf(resolved.semanticVersion).toEqualTypeOf<bigint>();
    expect("laneManifests" in resolved).toBe(false);
    expect("hotLayoutVersion" in resolved).toBe(false);
  });

  it("sorts fields lexicographically by dotPath", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          zed: { kind: "fixed-scalar", type: "u32" },
          group: {
            beta: { kind: "fixed-scalar", type: "u32" },
          },
          alpha: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );

    expect(resolved.manifest.fields.map((field) => field.dotPath)).toEqual([
      "alpha",
      "group.beta",
      "zed",
    ]);
  });

  it("does not let input object insertion order affect output manifest", () => {
    const left = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        revisionNote: "left note",
        fields: {
          zed: { kind: "fixed-scalar", type: "u32" },
          alpha: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );
    const right = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        revisionNote: "right note",
        fields: {
          alpha: { kind: "fixed-scalar", type: "u32" },
          zed: { kind: "fixed-scalar", type: "u32" },
        },
      }),
    );

    expect(right.manifest).toEqual(left.manifest);
    expect(right.semanticVersion).toBe(left.semanticVersion);
  });

  it("derives a deterministic semanticVersion for semantically identical input", () => {
    const contract = {
      key: "deck.runtime",
      family: "replaceable-snapshot",
      fields: {
        tempo: { kind: "fixed-scalar", type: "f64" },
        playing: { kind: "fixed-scalar", type: "bool" },
      },
      lanes: {
        warm: { codec: "framed-snapshot" },
      },
    } satisfies AuthoredProjectionContract;

    const first = unwrap(compileAuthoredProjectionContract(contract));
    const second = unwrap(compileAuthoredProjectionContract(contract));

    expect(first.semanticVersion).toBe(second.semanticVersion);
  });

  it("changes semanticVersion when nanSentinel changes", () => {
    const withoutNanSentinel = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );
    const withNanSentinel = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64", nanSentinel: true },
        },
      }),
    );

    expect(withNanSentinel.manifest).not.toEqual(withoutNanSentinel.manifest);
    expect(withNanSentinel.semanticVersion).not.toBe(withoutNanSentinel.semanticVersion);
  });

  it("preserves enum variant order", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          source: {
            kind: "fixed-enum",
            variants: ["link", "midi", "internal"],
            storage: "u8",
          },
        },
      }),
    );

    expect(resolved.manifest.fields[0]?.shape).toMatchObject({
      kind: "FixedEnum",
      variants: ["link", "midi", "internal"],
    });
  });
});

describe("@exclave/compiler schema boundary", () => {
  it("returns compiler failure for a structurally invalid authored contract", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({} as AuthoredProjectionContract),
    );

    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("compiler.compilationRejected");
    expect(error.details.issues.map((issue) => issue.code)).toContain("schema.invalid");
  });

  it("keeps CompilerError distinct from SchemaValidationError", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({} as AuthoredProjectionContract),
    );

    expect(error).toBeInstanceOf(ExclaveError);
    expect(error).not.toBeInstanceOf(SchemaValidationError);
  });
});

describe("@exclave/compiler field ids", () => {
  it("derives deterministic field ids", () => {
    const first = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );
    const second = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
      }),
    );

    expect(second.manifest.fields[0]?.fieldId).toBe(first.manifest.fields[0]?.fieldId);
  });

  it("rejects field id collisions", () => {
    const error = expectFailure(
      compileAuthoredProjectionContractWithOptions(
        {
          key: "deck.runtime",
          family: "replaceable-snapshot",
          fields: {
            alpha: { kind: "fixed-scalar", type: "u32" },
            beta: { kind: "fixed-scalar", type: "u32" },
          },
        },
        { fieldIdDeriver: () => 7 },
      ),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain("field.fieldIdCollision");
  });
});

describe("@exclave/compiler field identity artifacts", () => {
  it("emits artifact entries sorted lexicographically by dotPath", () => {
    const resolved = compileFieldIdentityFixture();
    const artifact = deriveProjectionFieldIdentityArtifact(resolved);

    expect(artifact.contractKey).toBe("deck.runtime");
    expect(artifact.semanticVersion).toBe(resolved.semanticVersion);
    expect(artifact.fields).toEqual([
      { dotPath: "peaks.postFader.left", fieldId: 101 },
      { dotPath: "peaks.postFader.right", fieldId: 102 },
      { dotPath: "transport.phase", fieldId: 201 },
      { dotPath: "transport.tempo", fieldId: 202 },
    ]);
  });

  it("can derive the same artifact from a canonical manifest", () => {
    const resolved = compileFieldIdentityFixture();

    expect(deriveProjectionFieldIdentityArtifactFromManifest(resolved.manifest)).toEqual(
      deriveProjectionFieldIdentityArtifact(resolved),
    );
  });

  it("builds a nested mirror with leaves equal to exact canonical dot paths", () => {
    const artifact = deriveProjectionFieldIdentityArtifact(compileFieldIdentityFixture());

    expect(buildProjectionFieldIdentityMirror(artifact.fields)).toEqual({
      peaks: {
        postFader: {
          left: "peaks.postFader.left",
          right: "peaks.postFader.right",
        },
      },
      transport: {
        phase: "transport.phase",
        tempo: "transport.tempo",
      },
    });
  });

  it("emits deterministic TypeScript field identity modules", () => {
    const first = compileFieldIdentityFixture();
    const second = compileFieldIdentityFixture(
      fieldIdentityFixture({
        revisionNote: "authoring order should not affect field identity output",
        fields: {
          peaks: {
            postFader: {
              left: { kind: "fixed-scalar", type: "f32" },
              right: { kind: "fixed-scalar", type: "f32" },
            },
          },
          transport: {
            phase: { kind: "fixed-scalar", type: "f64" },
            tempo: { kind: "fixed-scalar", type: "f64" },
          },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    const options = {
      fieldsConstName: "deckRuntimeFields",
      fieldPathTypeName: "DeckRuntimeFieldPath",
      fieldIdConstName: "deckRuntimeFieldIds",
    };

    const firstSource = emitTypeScriptFieldIdentityModule({ resolved: first, ...options });
    const secondSource = emitTypeScriptFieldIdentityModule({ resolved: second, ...options });

    expect(secondSource).toBe(firstSource);
    expect(firstSource).toBe(`export const deckRuntimeFields = {
  peaks: {
    postFader: {
      left: "peaks.postFader.left",
      right: "peaks.postFader.right",
    },
  },
  transport: {
    phase: "transport.phase",
    tempo: "transport.tempo",
  },
} as const;

export type DeckRuntimeFieldPath =
  | "peaks.postFader.left"
  | "peaks.postFader.right"
  | "transport.phase"
  | "transport.tempo";

export const deckRuntimeFieldIds = {
  "peaks.postFader.left": 101,
  "peaks.postFader.right": 102,
  "transport.phase": 201,
  "transport.tempo": 202,
} as const;
`);
  });

  it("carries semanticVersion from the resolved contract when emitting metadata", () => {
    const resolved = compileFieldIdentityFixture();
    const pinnedResolved = {
      ...resolved,
      semanticVersion: 42n,
    } satisfies ResolvedProjectionContract;

    const artifact = deriveProjectionFieldIdentityArtifact(pinnedResolved);
    const source = emitTypeScriptFieldIdentityModule({
      resolved: pinnedResolved,
      fieldsConstName: "deckRuntimeFields",
      fieldPathTypeName: "DeckRuntimeFieldPath",
      fieldIdConstName: "deckRuntimeFieldIds",
      metadataConstName: "deckRuntimeFieldIdentity",
    });

    expect(artifact.semanticVersion).toBe(42n);
    expect(source).toContain('contractKey: "deck.runtime"');
    expect(source).toContain("semanticVersion: 42n");
  });

  it("does not emit aliases or lane-specific version data", () => {
    const resolved = compileFieldIdentityFixture();
    expect(resolved.hotLayoutVersion).toBeDefined();

    const resolvedWithIgnoredMetadata = {
      ...resolved,
      aliases: {
        tempoBpm: "transport.tempo",
      },
    } as ResolvedProjectionContract;

    const source = emitTypeScriptFieldIdentityModule({
      resolved: resolvedWithIgnoredMetadata,
      fieldsConstName: "deckRuntimeFields",
      fieldPathTypeName: "DeckRuntimeFieldPath",
      fieldIdConstName: "deckRuntimeFieldIds",
      metadataConstName: "deckRuntimeFieldIdentity",
    });

    expect(source).not.toContain("alias");
    expect(source).not.toContain("tempoBpm");
    expect(source).not.toContain("hotLayoutVersion");
    expect(source).not.toContain("warmCodecVersion");
    expect(source).not.toContain("coldCodecVersion");
  });
});

describe("@exclave/compiler lane admissibility", () => {
  it("accepts a hot lane for a fixed scalar field", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(resolved.manifest.lanes.hot).toEqual({
      codec: "mapped-fixed",
      reservations: [],
    });
  });

  it("rejects a hot lane for a variable string field", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "lane.hotFieldNotAdmissible",
          path: "fields.title",
        }),
      ]),
    );
  });

  it("rejects unreserved bounded arrays and maps on the hot lane", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: { kind: "bounded-array", elementType: "f32", maxLength: 8 },
          lookup: {
            kind: "bounded-map",
            keyEncoding: "fixed-ascii",
            keyByteLength: 8,
            valueShape: { kind: "fixed-scalar", type: "u32" },
            maxEntries: 4,
          },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(
      error.details.issues.filter((issue) => issue.code === "lane.hotFieldNotAdmissible"),
    ).toHaveLength(2);
  });

  it("accepts reserved bounded arrays and maps on the hot lane", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: { kind: "bounded-array", elementType: "f32", maxLength: 8 },
          lookup: {
            kind: "bounded-map",
            keyEncoding: "fixed-ascii",
            keyByteLength: 8,
            valueShape: { kind: "fixed-scalar", type: "u32" },
            maxEntries: 4,
          },
        },
        lanes: {
          hot: {
            reservations: ["lookup", "samples"],
          },
        },
      }),
    );

    expect(resolved.manifest.lanes.hot?.reservations).toEqual(["lookup", "samples"]);
  });

  it("rejects reservations for fields that do not exist", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {
            reservations: ["missing"],
          },
        },
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "lane.hotReservationUnknownField",
    );
  });

  it("rejects reservations for non-bounded fields", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {
            reservations: ["tempo"],
          },
        },
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "lane.hotReservationWrongShape",
    );
  });

  it("deduplicates reservation mechanisms in canonical output", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: {
            kind: "bounded-array",
            elementType: "f32",
            maxLength: 8,
            hotReservation: true,
          },
        },
        lanes: {
          hot: {
            reservations: ["samples", "samples"],
          },
        },
      }),
    );

    expect(resolved.manifest.lanes.hot?.reservations).toEqual(["samples"]);
  });

  it("rejects field-local hot reservations without a hot lane", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          samples: {
            kind: "bounded-array",
            elementType: "f32",
            maxLength: 8,
            hotReservation: true,
          },
        },
      }),
    );

    expect(error.details.issues.map((issue) => issue.code)).toContain(
      "lane.hotReservationWithoutHotLane",
    );
  });
});

describe("@exclave/compiler hot lane manifests", () => {
  it("omits hot layout data when no hot lane is declared", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "fixture.noLane",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
      }),
    );

    expect(resolved.manifest.lanes.hot).toBeUndefined();
    expect(resolved.laneManifests?.hot).toBeUndefined();
    expect("laneManifests" in resolved).toBe(false);
    expect("hotLayoutVersion" in resolved).toBe(false);
  });

  it("emits a hot manifest and top-level hotLayoutVersion when hot is declared", () => {
    const resolved = unwrap(compileAuthoredProjectionContract(hotLayoutFixture()));
    const hotManifest = unwrapHotManifest(resolved);

    expect(hotManifest.contractKey).toBe(resolved.manifest.key);
    expect(resolved.hotLayoutVersion).toBe(hotManifest.hotLayoutVersion);
  });

  it("carries hot ABI constants from hot-codec planning", () => {
    const hotManifest = unwrapHotManifest(
      unwrap(compileAuthoredProjectionContract(hotLayoutFixture())),
    );

    expect(hotManifest).toMatchObject({
      blockASize: 72,
      blockBStartOffset: 72,
      fieldDataOrigin: 96,
      seqlockOffset: 72,
    });
  });

  it("emits deterministic hot field offsets for a small generic fixture", () => {
    const hotManifest = unwrapHotManifest(
      unwrap(compileAuthoredProjectionContract(hotLayoutFixture())),
    );

    expect(
      hotManifest.fields.map(({ dotPath, absoluteOffset, byteSpan, alignment }) => ({
        dotPath,
        absoluteOffset,
        byteSpan,
        alignment,
      })),
    ).toEqual([
      { dotPath: "cursor", absoluteOffset: 96, byteSpan: 1, alignment: 1 },
      { dotPath: "flags", absoluteOffset: 97, byteSpan: 3, alignment: 1 },
      { dotPath: "lookup", absoluteOffset: 100, byteSpan: 20, alignment: 4 },
      { dotPath: "meters", absoluteOffset: 120, byteSpan: 8, alignment: 4 },
      { dotPath: "peaks", absoluteOffset: 128, byteSpan: 16, alignment: 4 },
      { dotPath: "phase", absoluteOffset: 144, byteSpan: 8, alignment: 8 },
      { dotPath: "tempo", absoluteOffset: 152, byteSpan: 8, alignment: 8 },
    ]);
    expect(hotManifest.reservations).toEqual([
      {
        dotPath: "lookup",
        countFieldOffset: 100,
        elementsOffset: 104,
        maxCount: 2,
        unitByteLength: 8,
      },
      {
        dotPath: "peaks",
        countFieldOffset: 128,
        elementsOffset: 132,
        maxCount: 3,
        unitByteLength: 4,
      },
    ]);
  });

  it("produces identical hot manifests for equivalent authored inputs", () => {
    const left = unwrap(compileAuthoredProjectionContract(hotLayoutFixture()));
    const right = unwrap(
      compileAuthoredProjectionContract({
        ...hotLayoutFixture(),
        revisionNote: "object order should not matter",
        fields: {
          tempo: { type: "f64", kind: "fixed-scalar" },
          lookup: {
            maxEntries: 2,
            valueShape: { type: "f32", kind: "fixed-scalar" },
            keyByteLength: 4,
            keyEncoding: "fixed-ascii",
            kind: "bounded-map",
          },
          meters: { length: 2, elementType: "f32", kind: "fixed-vector" },
          peaks: { maxLength: 3, elementType: "f32", kind: "bounded-array" },
          flags: { encoding: "ascii", byteLength: 3, kind: "fixed-string-encoded" },
          phase: { type: "f64", kind: "fixed-scalar" },
          cursor: { type: "u8", kind: "fixed-scalar" },
        },
        lanes: {
          hot: {
            reservations: ["peaks", "lookup"],
          },
        },
      }),
    );

    expect(right).toEqual(left);
    expect(right.hotLayoutVersion).toBe(left.hotLayoutVersion);
  });

  it("changes hotLayoutVersion when a hot field width changes", () => {
    const f32Layout = unwrap(
      compileAuthoredProjectionContract(
        hotLayoutFixture({
          fields: {
            tempo: { kind: "fixed-scalar", type: "f32" },
          },
          lanes: {
            hot: {},
          },
        }),
      ),
    );
    const f64Layout = unwrap(
      compileAuthoredProjectionContract(
        hotLayoutFixture({
          fields: {
            tempo: { kind: "fixed-scalar", type: "f64" },
          },
          lanes: {
            hot: {},
          },
        }),
      ),
    );

    expect(f64Layout.laneManifests?.hot?.hotLayoutVersion).not.toBe(
      f32Layout.laneManifests?.hot?.hotLayoutVersion,
    );
  });

  it("changes hotLayoutVersion when a hot field encoding changes", () => {
    const asciiLayout = unwrap(
      compileAuthoredProjectionContract({
        ...hotLayoutFixture(),
        fields: {
          flags: { kind: "fixed-string-encoded", byteLength: 4, encoding: "ascii" },
        },
        lanes: {
          hot: {},
        },
      }),
    );
    const utf8Layout = unwrap(
      compileAuthoredProjectionContract({
        ...hotLayoutFixture(),
        fields: {
          flags: { kind: "fixed-string-encoded", byteLength: 4, encoding: "utf8" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(utf8Layout.laneManifests?.hot?.hotLayoutVersion).not.toBe(
      asciiLayout.laneManifests?.hot?.hotLayoutVersion,
    );
  });

  it("changes hotLayoutVersion when a hot field is added", () => {
    const oneField = unwrap(
      compileAuthoredProjectionContract({
        key: "fixture.hot",
        family: "replaceable-snapshot",
        fields: {
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {},
        },
      }),
    );
    const twoFields = unwrap(
      compileAuthoredProjectionContract({
        key: "fixture.hot",
        family: "replaceable-snapshot",
        fields: {
          phase: { kind: "fixed-scalar", type: "f64" },
          tempo: { kind: "fixed-scalar", type: "f64" },
        },
        lanes: {
          hot: {},
        },
      }),
    );

    expect(twoFields.laneManifests?.hot?.hotLayoutVersion).not.toBe(
      oneField.laneManifests?.hot?.hotLayoutVersion,
    );
  });

  it("does not change hotLayoutVersion when revisionNote changes", () => {
    const left = unwrap(
      compileAuthoredProjectionContract(hotLayoutFixture({ revisionNote: "left" })),
    );
    const right = unwrap(
      compileAuthoredProjectionContract(hotLayoutFixture({ revisionNote: "right" })),
    );

    expect(right.laneManifests?.hot?.hotLayoutVersion).toBe(
      left.laneManifests?.hot?.hotLayoutVersion,
    );
  });

  it("does not change hotLayoutVersion when warm or cold declarations change", () => {
    const hotOnly = unwrap(compileAuthoredProjectionContract(hotLayoutFixture()));
    const withWarmCold = unwrap(
      compileAuthoredProjectionContract(
        hotLayoutFixture({
          lanes: {
            hot: { reservations: ["lookup", "peaks"] },
            warm: {},
            cold: { materialization: "checkpointed-snapshot" },
          },
        }),
      ),
    );

    expect(withWarmCold.laneManifests?.hot?.hotLayoutVersion).toBe(
      hotOnly.laneManifests?.hot?.hotLayoutVersion,
    );
  });

  it("preserves hot-codec issue identity when hot planning rejects input", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({
        key: "fixture.hot",
        family: "replaceable-snapshot",
        fields: {
          peaks: {
            kind: "bounded-array",
            elementType: "f64",
            maxLength: 0xffffffff,
          },
        },
        lanes: {
          hot: { reservations: ["peaks"] },
        },
      }),
    );

    expect(error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "hot-codec",
          code: "hot-codec.planningFailed",
          causeCode: "layout.numericOutOfRange",
        }),
      ]),
    );
  });
});

describe("@exclave/compiler shared projection-runtime fixtures", () => {
  it("keeps hot-basic-v0 golden artifacts current", () => {
    const authoredContract = readFixtureJson(
      "authored-contract.json",
    ) as AuthoredProjectionContract;
    const resolved = unwrap(compileAuthoredProjectionContract(authoredContract));
    const compiledAgain = unwrap(compileAuthoredProjectionContract(authoredContract));
    const hotManifest = unwrapHotManifest(resolved);

    expect(toFixtureJson(resolved.manifest)).toEqual(readFixtureJson("canonical-manifest.json"));
    expect(toFixtureJson(hotManifest)).toEqual(readFixtureJson("hot-layout-manifest.json"));
    expect(toFixtureJson(resolved)).toEqual(readFixtureJson("resolved-contract.json"));

    expect(stableFixtureJson(compiledAgain.manifest)).toBe(stableFixtureJson(resolved.manifest));
    expect(stableFixtureJson(unwrapHotManifest(compiledAgain))).toBe(
      stableFixtureJson(hotManifest),
    );
    expect(stableFixtureJson(compiledAgain)).toBe(stableFixtureJson(resolved));

    expect(resolved.hotLayoutVersion).toBe(hotManifest.hotLayoutVersion);
    expect(toFixtureJson(resolved.hotLayoutVersion)).toBe(
      toFixtureJson(hotManifest.hotLayoutVersion),
    );
    expect(toFixtureJson(deriveSemanticVersion(resolved.manifest))).toBe("67b271f31c6b06a0");
    expect(toFixtureJson(resolved.semanticVersion)).toMatch(/^[0-9a-f]{16}$/);
    expect(toFixtureJson(resolved.hotLayoutVersion)).toMatch(/^[0-9a-f]{16}$/);

    expect(hotManifest).toMatchObject({
      blockASize: 72,
      blockBStartOffset: 72,
      seqlockOffset: 72,
      fieldDataOrigin: 96,
    });
    expect(
      hotManifest.fields.map(({ dotPath, absoluteOffset, byteSpan, alignment }) => ({
        dotPath,
        absoluteOffset,
        byteSpan,
        alignment,
      })),
    ).toEqual([
      { dotPath: "cursor", absoluteOffset: 96, byteSpan: 4, alignment: 4 },
      { dotPath: "health", absoluteOffset: 100, byteSpan: 1, alignment: 1 },
      { dotPath: "level", absoluteOffset: 104, byteSpan: 4, alignment: 4 },
      { dotPath: "peaks", absoluteOffset: 108, byteSpan: 16, alignment: 4 },
      { dotPath: "phase", absoluteOffset: 128, byteSpan: 8, alignment: 8 },
    ]);
    expect(hotManifest.reservations).toEqual([
      {
        dotPath: "peaks",
        countFieldOffset: 108,
        elementsOffset: 112,
        maxCount: 3,
        unitByteLength: 4,
      },
    ]);
  });
});

describe("@exclave/compiler warm and cold", () => {
  it("retains warm declarations and derives warm codec identity", () => {
    const resolved = unwrap(compileAuthoredProjectionContract(warmIdentityFixture()));
    const warmManifest = unwrapWarmManifest(resolved);

    expect(resolved.manifest.lanes.warm).toEqual({ codec: "framed-snapshot" });
    expectTypeOf(resolved.warmCodecVersion).toEqualTypeOf<bigint | undefined>();
    expect(resolved.warmCodecVersion).toBe(warmManifest.warmCodecVersion);
    expect(encodeU64Hex(warmManifest.warmCodecVersion)).toBe("4786106277feb166");
    expect(warmManifest).toMatchObject({
      codec: "framed-snapshot",
      contractKey: resolved.manifest.key,
      semanticVersion: resolved.semanticVersion,
    });
  });

  it("omits warmCodecVersion and warm lane manifest when no warm lane is declared", () => {
    const hotOnly = unwrap(compileAuthoredProjectionContract(hotLayoutFixture()));
    const noLane = unwrap(
      compileAuthoredProjectionContract({
        key: "fixture.noLane",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
      }),
    );

    expect("warmCodecVersion" in hotOnly).toBe(false);
    expect(hotOnly.laneManifests?.warm).toBeUndefined();
    expect("warmCodecVersion" in noLane).toBe(false);
    expect("laneManifests" in noLane).toBe(false);
  });

  it("emits warm lane manifests only when warm is declared", () => {
    const warmOnly = unwrap(compileAuthoredProjectionContract(warmIdentityFixture()));
    const hotOnly = unwrap(compileAuthoredProjectionContract(hotLayoutFixture()));

    expect(warmOnly.laneManifests?.warm).toBeDefined();
    expect(warmOnly.laneManifests?.hot).toBeUndefined();
    expect(hotOnly.laneManifests?.warm).toBeUndefined();
    expect(hotOnly.laneManifests?.hot).toBeDefined();
  });

  it("sorts warm manifest fields lexicographically by dotPath", () => {
    const warmManifest = unwrapWarmManifest(
      unwrap(compileAuthoredProjectionContract(warmIdentityFixture())),
    );

    expect(warmManifest.fields.map((field) => field.dotPath)).toEqual([
      "flags",
      "transport.phase",
      "transport.tempo",
      "zed",
    ]);
  });

  it("derives deterministic warmCodecVersion across authoring order changes", () => {
    const left = unwrap(compileAuthoredProjectionContract(warmIdentityFixture()));
    const right = unwrap(
      compileAuthoredProjectionContract(
        warmIdentityFixture({
          revisionNote: "object order should not matter",
          fields: {
            flags: { encoding: "ascii", byteLength: 3, kind: "fixed-string-encoded" },
            transport: {
              phase: { type: "f64", kind: "fixed-scalar" },
              tempo: { type: "f64", kind: "fixed-scalar" },
            },
            zed: { kind: "variable-string" },
          },
        }),
      ),
    );

    expect(right.warmCodecVersion).toBe(left.warmCodecVersion);
    expect(right.laneManifests?.warm).toEqual(left.laneManifests?.warm);
  });

  it("changes warmCodecVersion when a field shape changes", () => {
    const f32 = unwrap(
      compileAuthoredProjectionContract(
        warmIdentityFixture({
          fields: {
            tempo: { kind: "fixed-scalar", type: "f32" },
          },
        }),
      ),
    );
    const f64 = unwrap(
      compileAuthoredProjectionContract(
        warmIdentityFixture({
          fields: {
            tempo: { kind: "fixed-scalar", type: "f64" },
          },
        }),
      ),
    );

    expect(f64.warmCodecVersion).not.toBe(f32.warmCodecVersion);
  });

  it("changes warmCodecVersion when a field dotPath changes", () => {
    const tempo = unwrap(
      compileAuthoredProjectionContract(
        warmIdentityFixture({
          fields: {
            tempo: { kind: "fixed-scalar", type: "f64" },
          },
        }),
      ),
    );
    const speed = unwrap(
      compileAuthoredProjectionContract(
        warmIdentityFixture({
          fields: {
            speed: { kind: "fixed-scalar", type: "f64" },
          },
        }),
      ),
    );

    expect(speed.warmCodecVersion).not.toBe(tempo.warmCodecVersion);
  });

  it("does not change warmCodecVersion when only hot lane declarations change", () => {
    const warmOnly = unwrap(compileAuthoredProjectionContract(warmHotIdentityFixture()));
    const withHot = unwrap(
      compileAuthoredProjectionContract(
        warmHotIdentityFixture({
          lanes: {
            hot: { reservations: ["samples"] },
            warm: {},
          },
        }),
      ),
    );

    expect(withHot.hotLayoutVersion).toBeDefined();
    expect(withHot.warmCodecVersion).toBe(warmOnly.warmCodecVersion);
    expect(withHot.laneManifests?.warm).toEqual(warmOnly.laneManifests?.warm);
  });

  it("does not change warmCodecVersion when authoring-only metadata changes", () => {
    const left = unwrap(
      compileAuthoredProjectionContract(warmIdentityFixture({ revisionNote: "left" })),
    );
    const right = unwrap(
      compileAuthoredProjectionContract(warmIdentityFixture({ revisionNote: "right" })),
    );

    expect(right.warmCodecVersion).toBe(left.warmCodecVersion);
  });

  it("keeps warmCodecVersion distinct from hotLayoutVersion in a basic fixture", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract(
        warmHotIdentityFixture({
          lanes: {
            hot: { reservations: ["samples"] },
            warm: {},
          },
        }),
      ),
    );

    expect(resolved.hotLayoutVersion).toBeDefined();
    expect(resolved.warmCodecVersion).toBeDefined();
    expect(resolved.warmCodecVersion).not.toBe(resolved.hotLayoutVersion);
  });

  it("includes all canonical fields in the warm manifest without lane subsetting", () => {
    const resolved = unwrap(compileAuthoredProjectionContract(warmIdentityFixture()));
    const warmManifest = unwrapWarmManifest(resolved);

    expect(warmManifest.fields.map((field) => field.dotPath)).toEqual(
      resolved.manifest.fields.map((field) => field.dotPath),
    );
    expect(warmManifest.fields).toHaveLength(4);
    expect(warmManifest.fields.map((field) => field.dotPath)).toContain("zed");
  });

  it("retains cold declarations without producing coldCodecVersion", () => {
    const resolved = unwrap(
      compileAuthoredProjectionContract({
        key: "deck.runtime",
        family: "replaceable-snapshot",
        fields: {
          title: { kind: "variable-string" },
        },
        lanes: {
          cold: { materialization: "latest-snapshot" },
        },
      }),
    );

    expect(resolved.manifest.lanes.cold).toEqual({ materialization: "latest-snapshot" });
    expect("coldCodecVersion" in resolved).toBe(false);
  });
});

describe("@exclave/compiler error model", () => {
  it("compiler failure errors are ExclaveError values with code compiler.compilationRejected", () => {
    const error = expectFailure(
      compileAuthoredProjectionContract({} as AuthoredProjectionContract),
    );
    expect(error).toBeInstanceOf(ExclaveError);
    expect(error.code).toBe("compiler.compilationRejected");
    expect(error.details.issueCount).toBe(error.details.issues.length);
  });
});

describe("@exclave/compiler public surface", () => {
  it("exports only the intended runtime API", () => {
    expect(Object.keys(compiler).sort()).toEqual([
      "COMPILER_ERRORS",
      "COMPILER_ISSUE_DEFS",
      "buildProjectionFieldIdentityMirror",
      "compileAuthoredProjectionContract",
      "createCompilerError",
      "createCompilerIssue",
      "deriveProjectionFieldIdentityArtifact",
      "deriveProjectionFieldIdentityArtifactFromManifest",
      "emitTypeScriptFieldIdentityModule",
    ]);
    expect("CompilerError" in compiler).toBe(false);

    for (const runtimeExport of [
      "compileAuthoredProjectionContractWithOptions",
      "deriveSemanticVersion",
      "deriveFieldId",
      "normalizeSpecAst",
      "core",
      "createRuntimeBinding",
    ]) {
      expect(runtimeExport in compiler).toBe(false);
    }
  });

  it("exports the intended compiler type surface", () => {
    expectTypeOf<CompilerError["code"]>().toEqualTypeOf<"compiler.compilationRejected">();
    expectTypeOf<CanonicalFieldShape["kind"]>().toEqualTypeOf<
      | "FixedScalar"
      | "FixedEnum"
      | "FixedVector"
      | "FixedStringEncoded"
      | "BoundedArray"
      | "BoundedMap"
      | "VariableString"
      | "VariableMap"
    >();
  });
});
