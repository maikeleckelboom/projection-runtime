# Architecture Overview

Seqlok's public v1 package set is intentionally small.

## Current landed package graph

- `base`

## Intended public v1 packages

- `@seqlok/base`
- `@seqlok/schema`
- `@seqlok/primitives`
- `@seqlok/core`

## Intended graph

- `base`
- `schema -> base`
- `primitives -> base`
- `core -> base, schema, primitives`
