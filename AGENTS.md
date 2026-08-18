## Learned User Preferences

- Prefer GitHub Actions packaging as a `v*` tag / `workflow_dispatch` matrix rather than building Windows, macOS, and Linux on every pull request; cheap PR checks should stay lint, format, and typecheck on a single runner.

## Learned Workspace Facts

- Ungate Standalone is an Electron desktop host for the Ungate local proxy, dashboard, and Cloudflare tunnel; `vendor/ungate` is an unmodified Git submodule pinned to Ungate `v1.7.10`.
- Native packaging targets are Windows x64 (portable `UngateStandalone.exe` and NSIS `UngateStandalone-Setup.exe`), macOS x64/arm64 (unsigned DMG/zip), and Linux x64/arm64 (AppImage/deb). `pnpm run build` packages only the current OS; there is no Windows-to-macOS/Linux cross-compile.
- The bundled API runtime is Node.js 22.16.0 (MODULES ABI 127). `scripts/prepare-resources.mjs` stages per-target binaries under `resources/runtimes/<platform>-<arch>/`, and `scripts/before-pack.cjs` copies the matching runtime into `resources/runtime/` for electron-builder.
- Packaged apps install `cloudflared` into `$HOME/.ungate/bin` for the running platform instead of shipping the host npm binary; credentials and analytics stay in `$HOME/.ungate`.
- GitHub Actions `.github/workflows/build.yml` builds on `v*` tags and `workflow_dispatch`. Linux CI must not pack x64 and arm64 AppImage/deb on one x64 Ubuntu runner; use native jobs (`ubuntu-latest` + `build:linux:x64`, `ubuntu-24.04-arm` + `build:linux:arm64`) with `APPIMAGE_EXTRACT_AND_RUN=1` and fakeroot plus libfuse2/libfuse2t64.
- This repo has lint and format checks but no Electron-host test script; Vitest suites in `vendor/ungate` do not cover the standalone host, `beforePack`, or the bundled Node runtime.
