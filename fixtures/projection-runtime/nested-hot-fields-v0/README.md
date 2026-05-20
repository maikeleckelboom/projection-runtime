# nested-hot-fields-v0

This is a minimal projection-runtime fixture that proves nested dotPath fields survive through the full
authored-contract to generated-artifact pipeline.

## Purpose

The contract uses nested field objects to produce canonical dotPath field identities:

- `status.speed` (f32)
- `status.active` (bool)
- `meters.left` (f64)
- `meters.right` (f64)

The compiler flattens these to canonical dotPath form. The hot reader/writer/Rust writer generators derive safe local
identifiers from each dotPath while preserving canonical identity.

## Generated local identifiers

Canonical dotPath -> generated property/field names:

| dotPath         | TS property    | constant stem   | Rust field      |
|-----------------|----------------|-----------------|-----------------|
| `status.speed`  | `statusSpeed`  | `STATUS_SPEED`  | `status_speed`  |
| `status.active` | `statusActive` | `STATUS_ACTIVE` | `status_active` |
| `meters.left`   | `metersLeft`   | `METERS_LEFT`   | `meters_left`   |
| `meters.right`  | `metersRight`  | `METERS_RIGHT`  | `meters_right`  |

## Regeneration

From the repo root:

```sh
node scripts/write-projection-runtime-fixture.mts
```
