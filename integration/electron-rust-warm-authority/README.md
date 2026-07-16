# Electron/Rust Warm Authority Integration

This non-public integration fixture implements the
[Electron ↔ Rust Warm Authority Profile v0](../../docs/projection-runtime/electron-rust-warm-authority-profile-v0.md).
It launches a compiled standalone Rust authority through real Electron main, transfers a private `MessagePort` to a
bundled isolated preload, and exposes generated warm deck state to a sandboxed renderer.

Rust is the sole product-state authority. The Electron fixture contains private host assembly and proof-only lifecycle
controls; it is not a public Exclave Electron package.

## Run the focused proof

From the repository root:

```powershell
pnpm typecheck:electron-rust-warm-authority
cargo test --package electron-rust-warm-authority
pnpm exec vitest run --project electron-rust-warm-authority
pnpm build:electron-rust-warm-authority
pnpm test:electron-rust-warm-authority
```

The final command launches the actual Electron executable and the Rust binary, exercises startup, typed tempo control,
bounded slow-consumer coalescing, authority crash and replacement, explicit resubscription, renderer reload, continuity
rebase, and clean process teardown.

Use `pnpm verify` for the complete repository gate.
