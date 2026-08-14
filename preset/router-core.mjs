/**
 * router-core: reasoning-mode routing logic (zero dependencies).
 *
 * BEHAVIORAL REALITY (measured, 21-point × n=2 on v4-pro): model behavior
 * along the react↔spec axis collapses into THREE stable regions, not a
 * continuum — spec [0, 0.15], a transition band [0.2, 0.45] (unstable mix,
 * avoid), and react [0.5, 1.0] (11 mode values behave identically). The
 * numeric interface therefore maps onto three behavior bands; "continuous"
 * tuning is an illusion at the model layer.
 *
 *   mode 0    → pure spec  — plan-first, collective, read-first tools
 *   mode 0.5  → mixed      — spec sentence + light doer guidance (transition)
 *   mode 1    → pure react — doer, produce-verify-fix, test-suppressed
 *
 * `mode` is stored as a number in [0, 1] (the numeric API stays), but
 * `personaFor`/`coreFor` quantize to the three behavior bands.
 */

export const MODE_SPEC = 0
export const MODE_MIXED = 0.5
export const MODE_REACT = 1

const SPEC_PERSONA = 'You are a helpful software engineer assistant.'

const MIXED_PERSONA =
  'You are a helpful software engineer assistant.\n'
  + 'Work directly: prefer writing or editing code over describing plans. '
  + 'Verify your changes by reading and running them.'

const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'

/** Quantize a numeric mode to one of the three measured behavior bands. */
export function bandOf(mode) {
  const m = clamp01(mode)
  if (m < 0.2) return 'spec' // measured stable spec region (0..0.15)
  if (m < 0.5) return 'transition' // measured unstable band — avoid
  return 'react' // measured stable react region (0.5..1 behave alike)
}

/** Persona for a mode: three-band quantization (see header for evidence). */
export function personaFor(mode) {
  switch (bandOf(mode)) {
    case 'spec': return SPEC_PERSONA
    case 'transition': return MIXED_PERSONA
    default: return REACT_PERSONA
  }
}

/** First-turn core tools (shell added dynamically by the plugin). */
export function coreFor(mode) {
  switch (bandOf(mode)) {
    case 'spec': return ['read', 'edit', 'glob', 'grep'] // read-first
    case 'transition': return ['read', 'edit', 'write', 'glob', 'grep'] // union
    default: return ['read', 'write', 'edit'] // write-first
  }
}

/** Human-readable band name for a mode value. */
export function bandFor(mode) {
  const b = bandOf(mode)
  return b === 'transition' ? 'mixed' : b
}

/** Test-suppression strength for a mode (informational). */
export function testinessFor(mode) {
  return bandOf(mode) === 'react' ? 'suppressed' : bandOf(mode) === 'spec' ? 'normal' : 'light'
}

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function countHits(regex, text) {
  return [...text.matchAll(regex)].length
}

/**
 * Classify a task text into a mode value. The classifier only ever picks the
 * two stable bands (0 spec / 1 react); the measured transition band is a
 * trap and is never selected automatically. Ties and misses → spec.
 */
export function classifyTask(text) {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 1
  return 0
}

/** Per-session mode derived from durable events (resume-safe). */
export function sessionMode(session) {
  const events = session.events
  const userMsg = events.find((e) => e.type === 'user/message')
  return classifyTask(extractText(userMsg?.data))
}

export function extractText(data) {
  if (!data) return ''
  const content = Array.isArray(data.content) ? data.content : []
  return content.map((c) => (typeof c === 'string' ? c : (c.text ?? ''))).join(' ')
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

/**
 * Replace only the persona section of an assembled section list, keeping
 * everything else — the plan-mode section above all, which is toggled per
 * plan state and carries the plan-boundary instructions.
 */
export function applyPersona(sections, personaText) {
  const rest = (sections || []).filter(
    (section) => section.name !== 'persona' && !/persona/i.test(section.name),
  )
  return [...rest, { name: 'router-persona', text: personaText, order: 0 }]
}

/** Parse a user/agent-supplied mode token: number 0-100, 0.0-1.0, or a band name. */
export function parseMode(token) {
  if (token === undefined || token === null) return null
  const t = String(token).trim().toLowerCase()
  if (t === 'auto') return 'auto'
  if (t === 'spec' || t === 'spec-lean') return 0
  if (t === 'balanced' || t === 'mixed') return 0.3 // transition-band center
  if (t === 'react' || t === 'react-lean') return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('.')) return clamp01(n)
  return clamp01(n / 100)
}
