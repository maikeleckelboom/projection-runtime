# @seqlok/hot-consumer

`@seqlok/hot-consumer` v0 owns only bounded hot read attempts over an already-opened hot sequence view and a
caller-provided snapshot reader.

It uses `Atomics.load(sequence, 0)` on a caller-provided `BigUint64Array` sequence view. The caller owns how that view
was created and how the underlying memory was opened.

The read helper distinguishes two bounded retry conditions:

- writer-active-at-start, where the first sequence read is odd
- torn-read-after-even-start, where the first sequence read was even but the second sequence read changed

Those conditions use separate budgets. Writer-active polls do not consume torn-read budget, and torn reads do not
consume writer-active budget.

The package retains a mutable last-good snapshot in caller-held state. A clean even/even read updates `lastGood`;
bounded failure returns the retained snapshot or `null`. Torn candidates are discarded and are never exposed.

This package does not own `SharedArrayBuffer` lifecycle. It does not allocate, invalidate, or retire shared memory. It
does not open mappings. It does not implement binding state, stale or closed invalidation, generated bindings, Electron
integration, Rust writer behavior, warm/cold/resource work, or product authority contracts.
