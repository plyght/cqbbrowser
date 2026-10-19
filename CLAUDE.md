# SHORTBARREL

Bodycam-inspired CQB training shooter in the browser. Read `docs/PRD.md` first.

- Runtime/tooling: **bun** (`bun install`, `bun run dev`, `bun test src`, `bun run build`, `bunx playwright test`).
- Stack: TypeScript, Vite, Three.js, Rapier (`@dimforge/rapier3d-compat`), pmndrs `postprocessing`, Web Audio.
- Architecture: `src/core/Game.ts` owns the loop (fixed 60 Hz `fixedUpdate`, per-frame `update`). Systems talk via the typed
  event bus in `src/core/bus.ts`; gameplay reads input only via `ActionFrame` (`src/input/actions.ts`). Settings via
  `src/settings/Settings.ts` namespaces.
- Coordinates: metres, y up, yaw 0 faces -z. Weapon models: -z forward, origin at grip.
- Tests: unit tests next to code (`*.test.ts`, bun:test). E2E/screenshots in `tests/e2e` — use `boot/play/steps` helpers
  (manual deterministic stepping via `window.__sb`). Screenshots go to `screenshots/` (gitignored).
- Assets: only CC0 / generated files are committed while the repo is public. Log every external asset in
  `assets/ATTRIBUTION.md`. No Sonniss files until the repo is private.
- Before pushing: `bunx tsc --noEmit && bunx eslint . && bun test src && bunx prettier --check .`
