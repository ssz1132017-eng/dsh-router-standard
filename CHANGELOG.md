# Changelog

## v1.10.0 — 泄压插件移除 + 主动性自检（用户指令）

- **pressure-sensor 插件移除**（用户：不需要了）——`agent.cordis.yml` 删除 pressure-sensor 行；`pressure-sensor.mjs` 三处（分支/生产/源仓库）删除；事件通道/自适应阈值代码不再装配。
- **泄压引导 → 主动性自检**：常驻引导文本改为 Proactivity 自检（每轮先扫“可推进项”，可逆动作直接做并报告，只有用户偏好/不可逆/外部权限才问）；持久化段 `router-pressure` → `router-proactivity`。
- **主动性协议入声明**：`PROGRESSIVE_DECL` 增加 “act on reversible next steps; ask only for user-owned choices; report actions with evidence”。
- 版本 v1.15.0；selftest 同步（移除 sensor 断言，新增 no-pressure-plugin / proactivity-persist-section / proactivity-guide），lab+prod SELFTEST PASS。
- 实测：dev_router_status v1.15.0；`tools_catalog` 阶段0 bash=`[未解锁]`、阶段3=`[可调]`；run_code 元数据恢复。

## v1.9.0 — 自优化审计修复（v1.13/v1.14，用户实测驱动）

- **P1: bash invalid output** — `gitbash-executor` 缺少 `signal` → `canonicalBashResult` 输出 `signal: undefined` → run_code lossless-JSON 拒绝（`tool "bash" returned invalid output: value is not lossless JSON`）。执行器补 `signal: outcome?.signal ?? null`；本机/生产/源仓库已同步。
- **P1: run_code 二级披露空洞** — `registryFullIndex.findDef` 只查层链，host 注入的 `run_code` 无定义 → catalog/help 空描述/空参数；新增 host 兜底（view/schemas 反查）。
- **P1: 阶段状态落盘分裂** — `stageFile()` 用 `DSH_HOME || homedir()` 导致同一状态落在多个位置；统一 `DSH_HOME || homedir()/.dsh` 根，save/load 失败不再静默。
- **P2: dev_router_status 隐瞒 run_code** — `runtimeCallable` 的 `if (name === 'run_code') continue` 改为列入 base 入口。
- **P2: 双份描述/版本戳/48+ 陈旧** — 描述与版本单源（`DESC` + `ROUTER_VERSION`），`PROGRESSIVE_DECL` 去掉写死 48+，main/shim/文件头版本统一。
- **P2: 标签清义** — 「交付后」改「未解锁」（阶段 0 显示；bash 属验证档：阶段 1 起预放、阶段 3 全量；非“交付完成后才解锁”），阶段 0 引导补验证档说明。
- 验证：`node --check` ×3、selftest PASS、live reload 后 `dev_router_status` v1.14.0、catalog 阶段 0 bash=`[未解锁]` / 阶段 3=`[可调]`、`run_code` 元数据恢复。

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
