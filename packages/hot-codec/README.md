# @seqlok/hot-codec

`@seqlok/hot-codec` plans deterministic hot-lane layout manifests for Seqlok.

It is build-time planning code. It owns hot ABI constants, hot field layout planning, reservation metadata, region
sizing, `hotLayoutVersion` derivation, and pure deterministic hot field byte codec helpers.

The byte helpers encode and decode values against an already-planned `HotLayoutManifest`. They can produce field-data
bytes, full zero-filled fixture region bytes, and lowercase hex strings for golden fixtures.

They are not runtime readers or writers. They do not perform seqlock retry, use Atomics, manage SharedArrayBuffer
lifecycle, bind live mappings, create handles, subscribe to publications, or generate bindings.

This package intentionally does not import `@seqlok/compiler`. The compiler is expected to consume hot-codec in the
next slice to emit hot lane manifests, so hot-codec defines a local structural planning input compatible with canonical
compiler manifests instead of depending on compiler types.
