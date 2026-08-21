/**
 * router-bootstrap (standard edition v0.7): progressive tool disclosure revolution.
 *
 * 设计（用户定稿）：
 *   - 渐进式披露革命：阶段化渐进解锁（了解→方案→开发→验证→全量），
 *     每阶段注入指引（要解锁 X，先做 Y）——注意力始终在当前阶段工具上。
 *   - PTC 底座：run_code 一次执行多步（五轮变一轮）；SDK 段按阶段精简
 *     （39K 全量 → 当前阶段工具签名 + 全量声明），restrict 执行层双保险。
 *   - 二级披露：tools_catalog（轻索引）+ tools_help（重详情）——全量按需查。
 *   - 泄压引导（MAXential）：深度推理不循环 "but wait"，倒入泄压口——
 *     想一步/修正/分支合并，真正 settled 才完成；深度自主判断。
 *   - 无团队协议（we 提示词工程已移除——还原而非控制）。
 *
 * 运行期修复保留：claimed 首轮捕获 / pre-step 引导通道 / sessionModels /
 * 子代理放行 / dev_router_status+mode 自查自调。
 */

import {
  applyPersona, bandFor, bandOf, coreFor, parseMode, personaFor, sessionMode, testinessFor, clamp01,
  classifyTask, extractText, isComplexTask,
} from './router-core.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'router-bootstrap'

/** Prompt assembly, the tools registry, and the LLM route must exist. */
export const inject = ['systemPrompt', 'tools', 'llm']

/** Minimal spec → JSON Schema compiler (subset of defineTool's work). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** RL 训练接口的一句话 persona。 */
const RL_PERSONA = 'You are a helpful software engineer assistant.'

/** 渐进披露声明（首轮 system）。 */
const PROGRESSIVE_DECL =
  'We hold a full tool registry (48+ items), revealed in phases. '
  + 'tools_catalog lists every tool (name + summary); tools_help <name> returns '
  + 'any tool\'s complete spec. We query on demand and call precisely.'

/** 泄压引导（MAXential）——深度思考机制，非压制。 */
const PRESSURE_GUIDE =
  '\n\nPressure valve (MAXential): for deep reasoning we do not loop "but wait" — '
  + 'we pour it into the valve: think a step, revise an earlier step, branch + '
  + 'merge an alternative, and complete when truly settled. Depth is our call: '
  + 'a small result gets a small thought, a consequential fork gets full '
  + 'reasoning. Triggers: two or more dependent steps, asked the same thing '
  + 'twice, or caught restating a decision / reaching for "actually / but wait".'

/**
 * 阶段化渐进解锁（v0.7）：按任务阶段门控工具。
 */
const STAGES = [
  { name: '了解/对齐', tools: ['read', 'glob', 'grep', 'web_search', 'ask_user_question'] },
  { name: '拟合方案', tools: ['todo_write', 'exit_plan_mode'] },
  { name: '开发', tools: ['write', 'edit', 'str_replace_editor'] },
  { name: '验证', tools: ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill'] },
]

/** 阶段解锁指引（注入到用户消息后）。 */
const STAGE_GUIDES = [
  '\n\nPhase: understanding. Tools unlocked: read/glob/grep/web_search/ask_user_question. Align on the task: read context, clarify ambiguity. To unlock the planning phase, state our understanding and open a plan (todo_write).',
  '\n\nPhase: planning. Tools added: todo_write. Fit a concrete approach: decide the path, split steps, lock the plan. To unlock development (write/edit/str_replace_editor), complete the plan and write our first todo.',
  '\n\nPhase: development. Tools added: write/edit/str_replace_editor. Produce directly, one action per step. To unlock verification (pwsh/bash/read_image), finish the deliverable and say so.',
  '\n\nPhase: verification. Tools added: pwsh/bash/read_image/jobs. Verify what we built: run it, inspect output, fix what fails. When verified, deliver — the full catalog opens.',
]

const stageOf = new Map() // session id -> 0..3

export function apply(ctx, config) {
  const overrides = new Map()
  const agents = new Map()
  const firstUserText = new Map()
  const sessionModels = new Map()

  // ── first-turn capture: agent/inbox/claimed (#13) ─────────────────────────
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message?.source?.kind !== 'user') return
    const text = extractText(message)
    if (!text.trim()) return
    const session = agent?.session
    if (session !== undefined && !firstUserText.has(session.id)) {
      firstUserText.set(session.id, text.trim())
    }
  })

  /** PTC 阶段化 SDK：按当前阶段生成精简 SDK 文本（替换 tools:sdk 段）。 */
  function buildStagedSdk(sections, stage) {
    const sdk = sections.find((s) => s?.name === 'tools:sdk')
    if (!sdk) return null
    const stageTools = STAGES.slice(0, stage + 1).flatMap((s) => s.tools)
    const lines = [
      '## 阶段化工具（当前阶段可见，可直接 import 调用）',
      ...stageTools.map((t) => '- ' + t),
      '',
      '## 完整注册表（48+ 项）',
      '任意工具均可 import 调用（SDK 按需解析签名）；tools_catalog / tools_help 可查询完整清单与用法。',
    ]
    return { ...sdk, text: lines.join('\n') }
  }

  /** 按当前阶段收紧 restrict（执行层门控；PTC 下 SDK 调用同样受限）。 */
  function applyStageRestrict(agent, stage) {
    try {
      const toolsSvc = agent.ctx.get('tools')
      if (toolsSvc && typeof toolsSvc.restrict === 'function') {
        const allowed = new Set(STAGES.slice(0, stage + 1).flatMap((s) => s.tools))
        toolsSvc.restrict({ allow: [...allowed] })
      }
    } catch { /* scope-local names in allow: skip restrict, keep full catalog */ }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    if (agent.session?.header?.parentSession !== undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    const selectedModel = assembled.variables?.model
      ? { provider: assembled.variables?.provider, model: assembled.variables.model }
      : undefined
    if (selectedModel?.model) sessionModels.set(session.id, selectedModel)

    const promoted = session.events.some((event) => event.type === 'tool/call')
    const stage = stageOf.get(session.id) ?? 0

    // 首轮/未 promoted：RL 句 + 披露声明 + 泄压引导（轻 system）
    const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))
    const baseSections = planSection
      ? [planSection, { name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL + PRESSURE_GUIDE, order: 0 }]
      : [{ name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL + PRESSURE_GUIDE, order: 0 }]

    if (!promoted) {
      applyStageRestrict(agent, stage)
      const available = new Set(assembled.tools.map((tool) => tool.name))
      // PTC 底座：code mode 下工具面 = run_code + SDK 阶段化
      if (available.has('run_code')) {
        const staged = buildStagedSdk(baseSections, stage)
        const finalSections = staged ? baseSections.map((s) => (s.name === 'tools:sdk' ? staged : s)) : baseSections
        return { ...assembled, sections: finalSections, contexts: [] }
      }
      const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
      if (shell === null) throw new Error(`${name}: no platform shell in catalog`)
      const core = new Set(['str_replace_editor', shell, 'tools_catalog', 'tools_help'])
      return { ...assembled, sections: baseSections, contexts: [], tools: assembled.tools.filter((tool) => core.has(tool.name)) }
    }

    // promoted：官方完整 sections 回流 + persona 保持 RL 句 + 全目录（阶段 restrict 保留到验证完成）
    const sections = (assembled.sections || []).map((s) =>
      /persona/i.test(s.name) ? { ...s, text: RL_PERSONA } : s
    )
    return { ...assembled, sections, contexts: [] }
  })

  // ── 阶段指引注入（pre-step）：每条真实用户消息后注入当前阶段指引 ────────
  const guidedUserMessages = new Set()
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    if (agent === undefined || agent.session === undefined || agent.inbox === undefined) return decision
    const userMsg = messages.find((m) => m.role === 'user' && m.source?.kind === 'user')
    if (userMsg === undefined) return decision
    const text = extractText(userMsg)
    if (!text.trim() || guidedUserMessages.has(userMsg.id)) return decision
    guidedUserMessages.add(userMsg.id)

    const sid = agent.session.id
    const stage = stageOf.get(sid) ?? 0
    const events = agent.session.events || []
    const toolNames = events.filter((e) => e.type === 'tool/call').map((e) => e.data?.name || e.data?.toolName || '')
    let nextStage = stage
    if (stage === 0 && (toolNames.includes('todo_write') || /方案|计划|plan/i.test(text))) nextStage = 1
    if (stage === 1 && toolNames.some((n) => ['write', 'edit', 'str_replace_editor'].includes(n))) nextStage = 2
    if (stage === 2 && (toolNames.includes('pwsh') || toolNames.includes('bash') || /完成|finished|done|验证/i.test(text))) nextStage = 3
    if (nextStage > stage) {
      stageOf.set(sid, nextStage)
      applyStageRestrict(agent, nextStage)
    }

    const guide = STAGE_GUIDES[Math.min(stage, STAGE_GUIDES.length - 1)]
    try {
      agent.inbox.append('next-step', {
        id: 'router-guide-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        role: 'user',
        source: { kind: 'plugin', plugin: 'router-bootstrap' },
        content: [{ type: 'text', text: guide }],
      })
    } catch { /* duplicate/ordering races: skip */ }
    return decision
  })

  // ── 渐进式工具披露：二级注册表查询 ──────────────────────────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
    }))
  }

  function toolIndex() {
    const seen = new Set()
    const out = []
    for (const s of ctx.tools.schemas()) {
      const name = s.name || s.function?.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ name, desc: (s.description || s.function?.description || '').trim() })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  registerTool({
    name: 'tools_catalog',
    description: '渐进式披露一级：全部工具（名称 + 一行摘要）。query 关键词过滤；domain 域浏览（file/exec/network/delegate/memory/other）。',
    parameters: {
      query: { type: 'string', description: '关键词过滤（子串匹配名称/摘要）' },
      domain: { type: 'string', description: '域过滤：file / exec / network / delegate / memory / other' },
    },
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute(args) {
      const all = toolIndex()
      const q = String(args.query || '').toLowerCase()
      const d = String(args.domain || '').toLowerCase()
      const dom = (n, desc) => {
        const t = n + ' ' + desc
        if (/(read|write|edit|glob|grep|str_replace_editor|fs|file|path)/i.test(t)) return 'file'
        if (/(bash|pwsh|shell|run_code|exec|command|spawn)/i.test(t)) return 'exec'
        if (/(web|search|fetch|http|network|browse)/i.test(t)) return 'network'
        if (/(subagent|agent|delegate|workflow|ralph|fork)/i.test(t)) return 'delegate'
        if (/(engram|memory|recall|store|search)/i.test(t)) return 'memory'
        return 'other'
      }
      const rows = all.filter((t) => {
        if (q && !(t.name + ' ' + t.desc).toLowerCase().includes(q)) return false
        if (d && dom(t.name, t.desc) !== d) return false
        return true
      })
      if (rows.length === 0) return '（无匹配工具）'
      return rows.map((t) => '- ' + t.name + ' — ' + (t.desc.split(/\n|\. /)[0].slice(0, 90))).join('\n')
    },
  })

  registerTool({
    name: 'tools_help',
    description: '渐进式披露二级：单个工具的完整 schema（参数/必需/描述）。精准调用前先查。',
    parameters: {
      name: { type: 'string', required: true, description: '工具名（tools_catalog 里查到的）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute(args) {
      const name = String(args.name || '').trim()
      const all = toolIndex()
      const t = all.find((x) => x.name === name)
      if (!t) return '未知工具: ' + name + '（先用 tools_catalog 查）'
      for (const s of ctx.tools.schemas()) {
        const n = s.name || s.function?.name
        if (n !== name) continue
        const params = s.parameters || s.function?.parameters || {}
        const props = params.properties || {}
        const required = params.required || []
        const lines = ['工具: ' + name, '描述: ' + (s.description || s.function?.description || '')]
        const pLines = Object.entries(props).map(([k, v]) => {
          const meta = v || {}
          const req = required.includes(k) ? '（必需）' : ''
          return '  ' + k + ': ' + (meta.type || 'any') + req + ' — ' + (meta.description || '')
        })
        if (pLines.length) lines.push('参数:', ...pLines)
        return lines.join('\n')
      }
      return '未知工具: ' + name
    },
  })

  // ── router visibility & tuning ───────────────────────────────────────────
  const modeSpec = {
    mode: {
      type: 'string',
      required: true,
      description: 'band name (spec / weak / mixed / react)',
    },
  }

  registerTool({
    name: 'dev_router_status',
    description: 'Show the current routing state (phase, band, persona, unlocked tools, override).',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const mode = overrides.get(session.id) ?? sessionMode(session)
      const stage = stageOf.get(session.id) ?? 0
      const modelId = sessionModels.get(session.id)?.model ?? currentAgent()?.options?.model
      return [
        `router=standard (渐进披露 v0.7)`,
        `phase=${STAGES[stage].name}（阶段 ${stage}/3）`,
        `unlocked=[${STAGES.slice(0, stage + 1).flatMap((s) => s.tools).join(', ')}]`,
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `persona=${RL_PERSONA}`,
        `firstUser=${(firstUserText.get(session.id) ?? '').slice(0, 60)}`,
        `override=${overrides.has(session.id) ? 'yes' : 'no'}`,
      ].join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: 'Temporarily override the reasoning mode (spec/weak/mixed/react, 0-100, 0.0-1.0, or auto to clear).',
    parameters: modeSpec,
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute(args) {
      const parsed = parseMode(String(args.mode ?? '').trim())
      if (parsed === null) return `invalid mode "${args.mode}"`
      if (parsed === 'auto') {
        const session = currentSession()
        if (session !== undefined) overrides.delete(session.id)
        return 'auto: override cleared'
      }
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      overrides.set(session.id, parsed)
      return `mode set to ${parsed} (band=${bandFor(parsed)})`
    },
  })

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    const last = [...agents.values()].at(-1)
    return last?.session
  }

  function currentAgent() {
    const session = currentSession()
    return session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
  }
}

/** Human-readable band name for a mode value. */
function fmtMode(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  return m < 0.2 ? 'spec' : m < 0.5 ? 'mixed' : 'react'
}
