/**
 * router-bootstrap (react edition): RL-interface restoration first, self-routing after.
 *
 * 设计（用户定稿，v0.4）：
 *   首轮 = RL 接口还原：system 只有 RL 训练句（46 字符）+ shell/str_replace_editor
 *   双工具 + sections 清空（plan 保留）。模型回到训练接口，自然"想一段做一段"。
 *   后期（首个 tool/call 后）= 恢复自路由：官方完整 sections 回流（身份/工具引导/
 *   规则）+ 全目录；每条真实用户消息经 agent/pre-step 注入一条近场引导
 *   （isComplexTask 选 fast-converge / deep-explore），模型自己判断、自己调整。
 *   无关键词分类换 persona（已废弃——classifyTask 计数换装是傻逼设计）。
 *
 * 运行期修复保留（v0.3.0 社区验证）：
 *   - agent/inbox/claimed：捕获首条真实用户消息（用于引导选择/状态显示）
 *   - agent/pre-step 引导注入：同一请求携带引导（免 2× API 调用）
 *   - sessionModels（assembled.variables）：会话选择模型
 *   - 子代理放行（parentSession）
 *   - dev_router_status / dev_router_mode：模型自查自调（自路由工具）
 *
 * Zero external imports on purpose: relative preset rows resolve bare
 * specifiers from the user home, where `@deepseek-ai/*` is not installed.
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

/** RL 训练接口的一句话 persona（还原，非控制）。 */
const RL_PERSONA = 'You are a helpful software engineer assistant.'

/**
 * 阶段化渐进解锁（v0.5 用户设计定稿）：按任务阶段门控工具。
 * 每个阶段注入指引（要解锁 X，先做 Y）——模型自然走
 * 了解→方案→开发→验证 的最优通用路径，注意力始终在当前阶段工具上。
 */
const STAGES = [
  { name: '了解/对齐', tools: ['read', 'glob', 'grep', 'web_search', 'ask_user_question', 'tools_catalog', 'tools_help'] },
  { name: '拟合方案', tools: ['todo_write', 'exit_plan_mode'] },
  { name: '开发', tools: ['write', 'edit', 'str_replace_editor'] },
  { name: '验证', tools: ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill'] },
]

/** 阶段解锁指引（注入到用户消息后，替换旧的 GUIDE 文本）。 */
const STAGE_GUIDES = [
  // 阶段 0
  '\n\nWe are in the understanding phase. Tools available: read/glob/grep/web_search/ask_user_question (+tools_catalog/tools_help to inspect the full registry). Align on the task: read the relevant context, clarify anything ambiguous. To unlock the planning phase, state our understanding and open a plan (todo_write).',
  // 阶段 1
  '\n\nWe are in the planning phase. Tools added: todo_write. Fit a concrete approach: decide the path, split steps, lock the plan. To unlock the development phase, complete the plan and write our first todo. Development tools (write/edit/str_replace_editor) unlock next.',
  // 阶段 2
  '\n\nWe are in the development phase. Tools added: write/edit/str_replace_editor. Produce directly, one action per step. To unlock the verification phase, finish the deliverable and say so. Execution tools (pwsh/bash/read_image) unlock next.',
  // 阶段 3
  '\n\nWe are in the verification phase. Tools added: pwsh/bash/read_image/jobs. Verify what we built: run it, inspect output, fix what fails. When verified, deliver — the full catalog opens.',
]

/** 当前阶段（session 级状态；推进由 bootstrap 判断）。 */
const stageOf = new Map() // session id -> 0..3
const PROGRESSIVE_DECL =
  'We hold a full tool registry (48+ items). tools_catalog lists every tool '
  + '(name + one-line summary); tools_help <name> returns any tool\'s complete '
  + 'spec. We query on demand and call precisely — no need to read the whole '
  + 'catalog up front.'

export function apply(ctx, config) {
  const overrides = new Map() // session id -> explicit mode (number 0..1, 自查自调)
  const agents = new Map() // session id -> Agent (live handle, in-process only)
  const firstUserText = new Map() // session id -> first REAL user message text (#13)
  const sessionModels = new Map() // session id -> { provider, model } from assembled.variables (#9)

  // ── first-turn capture: agent/inbox/claimed (#13) ─────────────────────────
  // Claim 在 assemble 前同步派发——首条真实用户消息文本在此捕获（用于
  // dev_router_status 显示与引导选择；不用于 persona 分派）。
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message?.source?.kind !== 'user') return
    const text = extractText(message)
    if (!text.trim()) return
    const session = agent?.session
    if (session !== undefined && !firstUserText.has(session.id)) {
      firstUserText.set(session.id, text.trim())
    }
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    // 子代理放行（#5）
    if (agent.session?.header?.parentSession !== undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    // #9: 会话选择模型（assembled.variables）
    const selectedModel = assembled.variables?.model
      ? { provider: assembled.variables?.provider, model: assembled.variables.model }
      : undefined
    if (selectedModel?.model) sessionModels.set(session.id, selectedModel)

    const promoted = session.events.some((event) => event.type === 'tool/call')

    if (!promoted) {
      // ── 首轮：RL 接口还原 ──────────────────────────────────────────────
      // system = 只有 RL 训练句（+ plan 段保留）；身份/Web/工具引导/规则全清空
      // （minimal 的 complete:true 语义）。工具面 = shell + str_replace_editor。
      const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))
      const sections = planSection
        ? [planSection,
          { name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL, order: 0 }]
        : [{ name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL, order: 0 }]

      const available = new Set(assembled.tools.map((tool) => tool.name))
      const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
      if (shell === null) {
        throw new Error(`${name}: no platform shell in catalog`)
      }
      // 阶段化解锁：首轮 restrict 阶段 0 工具（了解/对齐）
      // （restrict 只影响全局工具；scope-local 的 shell/str_replace_editor 首轮
      // 保留——干活基础。阶段工具由 restrict 门控 + 引导推进。）
      const stage = stageOf.get(session.id) ?? 0
      const allowed = new Set(STAGES.slice(0, stage + 1).flatMap((s) => s.tools))
      try {
        const toolsSvc = agent.ctx.get('tools')
        if (toolsSvc && typeof toolsSvc.restrict === 'function') {
          toolsSvc.restrict({ allow: [...allowed] })
        }
      } catch { /* scope-local names in allow: skip restrict, keep full catalog */ }

      const core = new Set(['str_replace_editor', shell, 'tools_catalog', 'tools_help'])

      return { ...assembled, sections, contexts: [], tools: assembled.tools.filter((tool) => core.has(tool.name)) }
    }

    // ── 后期：恢复自路由 ────────────────────────────────────────────────
    // 官方完整 sections 回流（身份/工具引导/规则——模型进入完整工作状态），
    // persona 段保持 RL 句（还原身份不丢）；全目录。自路由 = 模型自己判断
    // 任务/风格，近场引导（pre-step）在旁边辅助收敛，不做关键词分类换装。
    const sections = (assembled.sections || []).map((s) =>
      /persona/i.test(s.name) ? { ...s, text: RL_PERSONA } : s
    )
    return { ...assembled, sections, contexts: [] }
  })

  // ── 近场引导（自路由辅助，agent/pre-step 通道 #34/#36/#55）───────────────
  // 每条真实用户消息后注入一条引导：isComplexTask 选 fast-converge（简单）/
  // deep-explore（复杂）。缓存中性、同一请求携带（免 2× API 调用）。
  // 阶段指引注入（agent/pre-step）：每条真实用户消息后注入当前阶段指引，
  // 说明已解锁工具 + 解锁下一阶段的条件。阶段推进：模型行为信号。
  const guidedUserMessages = new Set() // user message id -> 已注入，防重复
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    if (agent === undefined || agent.session === undefined || agent.inbox === undefined) return decision
    const userMsg = messages.find((m) => m.role === 'user' && m.source?.kind === 'user')
    if (userMsg === undefined) return decision
    const text = extractText(userMsg)
    if (!text.trim() || guidedUserMessages.has(userMsg.id)) return decision
    guidedUserMessages.add(userMsg.id)
    // 阶段推进判断（行为信号）：
    //   0→1: 出现 todo_write 调用 或 用户消息含"方案/计划/plan"
    //   1→2: 出现首个 write/edit/str_replace_editor 调用（开发工具解锁后）
    //   2→3: 交付声明（"完成/finished/done"）或 首个 pwsh 执行
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
      // 阶段推进时刷新 restrict（下一阶段工具解锁）
      try {
        const toolsSvc = agent.ctx.get('tools')
        if (toolsSvc && typeof toolsSvc.restrict === 'function') {
          const allowed = new Set(STAGES.slice(0, nextStage + 1).flatMap((s) => s.tools))
          toolsSvc.restrict({ allow: [...allowed] })
        }
      } catch { /* ignore */ }
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
  // ── router visibility & tuning (agent self-optimization) ────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
      // output.schema is already a plain JSON Schema; keep it as-is
    }))
  }

  const modeSpec = {
    mode: {
      type: 'string',
      required: true,
      description: 'band name (spec / weak / mixed / react)',
    },
  }


  // ── 渐进式工具披露（独家技术）：二级披露，按需查询 ─────────────────────
  // 一级 tools_catalog：全部工具名 + 一行摘要（轻索引，缓存友好）。
  // 二级 tools_help：单个工具完整 schema（重详情，仅需要时支付）。
  // 动态来源：ctx.tools.schemas()——新注册工具自动出现，无需维护名单。
  function toolIndex() {
    const seen = new Set()
    const out = []
    for (const s of ctx.tools.schemas()) {
      const name = s.name || s.function?.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      const desc = (s.description || s.function?.description || '').trim()
      out.push({ name, desc })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  registerTool({
    name: 'tools_catalog',
    description: '渐进式工具披露一级：列出工具注册表的全部工具（名称 + 一行摘要）。可选 query 按关键词过滤；可选 domain 按域浏览（file/exec/network/delegate/memory/other）。返回轻量索引——需要完整用法时用 tools_help。',
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
    description: '渐进式工具披露二级：返回单个工具的完整 schema（参数/必需/描述）。需要精准调用某个工具时先查它。',
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

  registerTool({
    description: 'Show the current reasoning-mode routing state (session mode, band, persona, core tools, override).',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },async execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const mode = overrides.get(session.id) ?? sessionMode(session)
      const modelId = sessionModels.get(session.id)?.model ?? currentAgent()?.options?.model
      return [
        `router=react (RL接口还原 → 自路由)`,
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `persona=${RL_PERSONA}`,
        `core=[str_replace_editor, shell]（首轮）→ 全目录（promoted）`,
        `firstUser=${(firstUserText.get(session.id) ?? '').slice(0, 60)}`,
        `testiness=${testinessFor(mode)}`,
        `override=${overrides.has(session.id) ? 'yes' : 'no'}`,
      ].join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: 'Temporarily override the reasoning mode (spec/weak/mixed/react, 0-100, 0.0-1.0, or auto to clear). Self-optimization loop for the agent itself.',
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
        return 'auto: override cleared (session derives its mode again)'
      }
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      overrides.set(session.id, parsed)
      return `mode set to ${parsed} (band=${bandFor(parsed)})`
    },
  })

  registerTool({
    name: 'dev_mode_subagent',
    description: 'Run one task in a DIFFERENT reasoning mode inside a fresh isolated context (its own system prompt), leaving the current trajectory untouched.',
    parameters: {
      mode: { type: 'string', required: true, description: 'spec / react / balanced' },
      task: { type: 'string', required: true, description: 'the task to hand to the mode-isolated subagent' },
    },
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: String(v) }],
    },
    async execute(args) {
      const parsed = parseMode(String(args.mode ?? '').trim())
      if (parsed === null) return `invalid mode "${args.mode}"`
      const model = sessionModels.get(currentSession()?.id)?.model ?? currentAgent()?.options?.model
      const persona = personaFor(parsed, model)
      const messages = [
        { role: 'system', content: persona },
        { role: 'user', content: String(args.task ?? '') },
      ]
      try {
        const agentLoop = ctx.get('agentLoop')
        const handle = await agentLoop.createAgent(ctx, {
          sessionId: 'mode-subagent-' + Date.now().toString(36),
          meta: { cwd: process.cwd(), origin: 'subagent' },
          agentOptions: { provider: 'deepseek-official', model },
          seed: messages,
        })
        let text = ''
        let reasoningChars = 0
        const stream = handle.agent.stream()
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'reasoning-delta') reasoningChars += chunk.text.length
        }
        const head = text.slice(0, 3000)
        return `[mode-subagent ${bandFor(parsed)} | reasoning ${reasoningChars} chars]\n${head}${text.length > 3000 ? '\n…(truncated)' : ''}`
      } catch (error) {
        return `subagent error: ${error && error.message ? error.message : String(error)}`
      }
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
