# Changelog

## v1.8.0 — Progressive disclosure suite（研发线，未发布）

Self-optimization rounds v1.3 → v1.8 (five real-session feedback loops, Gargantua / suspension-workstation builds):

- **Progressive tool disclosure** — stage-gated unlock (了解→拟合方案→开发→验证), two-tier pre-unlock (write/edit callable from stage 0), jump semantics (calling a pre-unlocked tool lands at its phase), full-catalog delivery at verification.
- **Two-level registry** — `tools_catalog` (full index + phase marks + param hints with types/defaults) / `tools_help` (complete schema); shared main+shim implementation, no drift.
- **PTC base** — staged SDK (39K → phase-visible signatures via `sdkSchemas(view)`), stage header, meta tools bound at `phase_begin`; path auto-encoding (Chinese/raw paths → file:// URL).
- **dev_page_check (v1.7)** — headless Chrome in one call: fresh profile (kills the 600s profile-mutex hang), hard-timeout tree kill, screenshot + DOM smoke, **console/pageerror extraction** (`--enable-logging=stderr`), **title field**, **selector text extraction** (#id/.class/tag), **scale** (device-factor zoom), DOM noise stripped (style/script); **`js` mode** = local VM engine (syntax check + pure-logic unit tests, IIFE return support — no external node needed).
- **Description ⇄ behavior alignment** — `presentation=code|native` self-check (never assert, show actual), marker single semantics (可调/交付后/meta/全量), honest phase text ("Callable now / not yet callable until delivery"), `phase_begin` always visible, `phase_advance` strictly one stage.
- **Platform truth** — bash disabled on win32 (host shell seam is pwsh-only; the old bash row ran pwsh semantics — root cause found), node (harness runtime) prepended to PATH, restrict double-filtered (GLOBAL_SAFE ∩ restrictableNames) so a platform-missing name can never disable the stage gate.
- **Pressure sensor** — real `session/event` channel (was dead), model-adaptive thresholds (Flash 0.6×), cooldown 3 steps, meaning-clarified message ("self-check signal, not an order"), v1.8: loop-pattern fires only alongside ≥2 no-action steps.
- **Goals/memory glue** — goal tools shim (read-before-update, complete/blocked authority), engram stage layout, persistent declaration & pressure sections (survive compaction).

## 0.3.0 — earlier router line

Task-aware reasoning-mode routing (classified persona + first-turn core surface + near-field guides); superseded by the progressive disclosure suite above.
