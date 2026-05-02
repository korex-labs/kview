# Agent Instructions

- When the user asks for a git commit message suggestion, provide a Conventional Commits-style subject and a body.
- Use the repository Docker toolchain for validation instead of the host Go/Node toolchain.
  - Prefer `make check` for full validation.
  - Prefer `make ui` or `make build-webview` for UI build validation.
  - Do not run `npm run ...` directly from `ui/` unless the user explicitly asks to use the host toolchain.
