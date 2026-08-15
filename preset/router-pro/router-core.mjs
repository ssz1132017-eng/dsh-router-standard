/**
 * router-pro: reasoning-mode routing for DeepSeek V4 Pro (measured-optimal).
 *
 * V4 PRO-SPECIFIC DESIGN (all numbers from official-API probes, 2026-08-15):
 *
 * 1. THREE-BAND STRUCTURE (n=570, AIC 668.7 vs logit 697.9):
 *      spec [0, 0.025]     → ψ₁ = 0.925   (RL interface)
 *      transition [0.025, 0.455] → ψ₁ = 0.464 (COMPETITION TRAP — never)
 *      react [0.455, 1]    → ψ₁ = 0.073   (doer)
 *    xc = 0.192 (bootstrap CI [0.151, 0.229]); bandOf spec boundary tightened
 *    from 0.2 to 0.03 per the E2 discrimination matrix (anti-routing from
 *    x=0.03: −9.2..−10.6 on greenfield tasks).
 *
 * 2. WEAK = router-v2 few-shot, NOT w6c. Discrimination (n=10):
 *      router-v2 +2.6 | react +2.2 | w7 +2.0 | neutral +1.1 | w6c +0.2 | spec −4.5
 *    w6c (spec sentence + classify) is ANTI-ROUTING on Pro — removed.
 *
 * 3. RL INTERFACE for maintenance-family tasks (anchored-standard evidence:
 *    Project2 98/99 on Windows Pro vs 91 Standard). spec band gets the
 *    one-sentence persona + bash/str_replace_editor surface; the full
 *    catalog is exposed after the first durable tool call.
 *
 * 4. DOER interface for build-family tasks (Mario: code-mode 10/10 vs
 *    anchored 6/10). react band gets the hands-on persona + write-first
 *    surface. Long-chain measurement (G-pro): Pro locks doer on build
 *    tasks; no Okay-token trigger (Mid-Think trigger is Flash-specific,
 *    measured neutral on Pro) — depth is task-driven on Pro.
 *
 * 5. NO OUTPUT CAP: tool-schema anchoring holds at maxTokens=256000
 *    (xiaobright issue #11: schema identity, not cap, decides the first
 *    request). The transition band is never selected automatically.
 *
 * Mode values: 0 spec / 1 react / 'weak'; numeric quantizes to three bands.
 */

export const MODE_SPEC = 0
export const MODE_REACT = 1
export const MODE_WEAK = 'weak'

/** RL training interface — the one-sentence persona of the official minimal
 *  preset (complete:true sole prompt section). */
const RL_PERSONA = 'You are a helpful software engineer assistant.'

const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'

/** Weak (internal-routing) persona — router-v2 few-shot, the measured Pro
 *  optimum (discrimination +2.6, n=10). NOT the spec-sentence+classify
 *  variant (w6c: +0.2, anti-routing when greenfield). */
const WEAK_PRO =
  'You are a software engineer. Match your working style to the task type.\n'
  + 'Example 1: "fix the broken login flow" → inspect first, plan, then edit carefully.\n'
  + 'Example 2: "write a new CSV processing script" → write the code directly and verify it runs.\n'
  + 'Follow the same rule for the actual request.'

/** Weak persona for Flash (w7, measured +4.6 discrimination) — neutral
 *  prefix + classify + recall/anti-runaway anchors. Flash and Pro are
 *  DIFFERENT models: Flash's weak optimum is w7 (not router-v2), Flash
 *  benefits from the Okay token trigger (F1: +40–115% depth at 100% action)
 *  and the decision-closure guide is neutral on Flash (P30) — so the
 *  closure loop is Pro-only. */
const WEAK_FLASH =
  'You are a helpful assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.\n'
  + 'Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.\n'
  + 'Think deeply first, then produce.'

/** True when the routed model id is a Flash-family model. */
export function isFlashModel(modelId) {
  return typeof modelId === 'string' && /flash/i.test(modelId)
}

/** Complexity heuristic: long or architecturally-worded tasks are COMPLEX. */
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i

export function isComplexTask(text) {
  return typeof text === 'string' && (text.length > 120 || COMPLEX_RE.test(text))
}

/** Measured bands (E2 + B/D fusion). transition is a trap: 9/12 probe
 *  points anti-route (−2.0..−10.6), 2 no-discrimination; never selected. */
export const BAND_SPEC_MAX = 0.03
export const BAND_REACT_MIN = 0.455

/** Quantize a mode to one of the three usable behavior bands. */
export function bandOf(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  if (m < BAND_SPEC_MAX) return 'spec' // RL interface, stable
  if (m < BAND_REACT_MIN) return 'transition' // competition trap — avoid
  return 'react' // doer, stable
}

/** Persona for a mode; weak picks the model-specific measured optimum
 *  (Pro → router-v2 few-shot; Flash → w7). */
export function personaFor(mode, modelId) {
  switch (bandOf(mode)) {
    case 'spec': return RL_PERSONA
    case 'weak': return isFlashModel(modelId) ? WEAK_FLASH : WEAK_PRO
    case 'transition': return RL_PERSONA // defensive: never auto-selected
    default: return REACT_PERSONA
  }
}

/** First-turn core tools (shell added dynamically by the plugin).
 *  spec/weak: RL shape (str_replace_editor; bash added by plugin).
 *  react: write-first. transition: never selected. */
export function coreFor(mode) {
  switch (bandOf(mode)) {
    case 'spec': return ['str_replace_editor']
    case 'weak': return ['str_replace_editor']
    case 'transition': return ['read', 'write', 'edit']
    default: return ['read', 'write', 'edit'] // write-first
  }
}

/** Human-readable band name. */
export function bandFor(mode) {
  const b = bandOf(mode)
  return b === 'transition' ? 'mixed' : b
}

/** Test-suppression strength (informational). */
export function testinessFor(mode) {
  return bandOf(mode) === 'react' ? 'suppressed' : 'normal'
}

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function countHits(regex, text) {
  return [...text.matchAll(regex)].length
}

/** Classify a task into spec (maintenance → RL interface) or react
 *  (build → doer); AMBIGUOUS returns 'weak' (internal routing, router-v2). */
export function classifyTask(text) {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 1
  if (spec > react) return 0
  return 'weak'
}

/** Per-session mode derived from durable events (resume-safe). */
export function sessionMode(session) {
  const events = session.events
  const userMsg = events.find((e) => e.type === 'user/message')
  return classifyTask(extractText(userMsg?.data))
}

export function extractText(data) {
  if (!data) return ''
  const payload = data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.map((c) => (typeof c === 'string' ? c : (c.text ?? ''))).join(' ')
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

/** Replace only the persona section, keeping plan-mode and other sections. */
export function applyPersona(sections, personaText) {
  const rest = (sections || []).filter(
    (section) => section.name !== 'persona' && !/persona/i.test(section.name),
  )
  return [...rest, { name: 'router-persona', text: personaText, order: 0 }]
}

/** Parse a user/agent-supplied mode token. */
export function parseMode(token) {
  if (token === undefined || token === null) return null
  const t = String(token).trim().toLowerCase()
  if (t === 'auto') return 'auto'
  if (t === 'weak' || t === 'router') return 'weak'
  if (t === 'spec' || t === 'spec-lean') return 0
  if (t === 'react' || t === 'react-lean') return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('.')) return clamp01(n)
  return clamp01(n / 100)
}
