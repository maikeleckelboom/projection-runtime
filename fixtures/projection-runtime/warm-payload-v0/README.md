# warm-payload-v0

This fixture proves the TypeScript Warm Codec v1 payload byte contract for a warm-only projection fixture.

It covers a manifest-derived `framed-snapshot` warm lane without adding transport, publication runtime, subscription
lifecycle, hot mapped regions, resource runtime, or cold reopen behavior. The checked-in payload artifact records
deterministic payload bytes, the decoded logical snapshot, and a composed outer warm frame byte proof using the same
payload bytes.

This fixture is validated by `@exclave/conformance` under the `warm-payload-codec` fixture profile. It intentionally
does not include hot layout manifests, hot byte fixtures, Block A/Block B fixtures, complete hot regions, generated hot
readers, generated hot writers, or Rust hot writers.

