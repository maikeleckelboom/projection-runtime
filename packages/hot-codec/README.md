# @seqlok/hot-codec

`@seqlok/hot-codec` plans deterministic hot-lane layout manifests for Seqlok.

It is build-time planning code. It owns hot ABI constants, hot field layout planning, reservation metadata, region
sizing, and `hotLayoutVersion` derivation.

It does not perform runtime reads or writes, manage SharedArrayBuffer lifecycle, implement hot consumer retry policy, or
generate bindings.

This package intentionally does not import `@seqlok/compiler`. The compiler is expected to consume hot-codec in the
next slice to emit hot lane manifests, so hot-codec defines a local structural planning input compatible with canonical
compiler manifests instead of depending on compiler types.
