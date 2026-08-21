/**
 * router-bootstrap (standard edition v0.9): progressive tool disclosure revolution —
 * self-routed phases: one bootstrap guide per session, then zero injection.
 * Stage state is persisted per session (resume-safe) and shown as system-prompt
 * state (router-stage section + dev_router_status); tools unlock like levels,
 * with the next tier pre-unlocked — using it advances the phase.
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
  classifyTask, extractText, isComplexTask, advanceStage,
} from './router-core.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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
  { name: '了解/对齐', tools: ['read', 'glob', 'grep', 'web_search', 'ask_user_question', 'engram_recall', 'engram_verify', 'engram_respond'] },
  { name: '拟合方案', tools: ['todo_write', 'exit_plan_mode', 'engram_search', 'engram_open'] },
  { name: '开发', tools: ['write', 'edit', 'str_replace_editor', 'engram_store', 'engram_link'] },
  { name: '验证', tools: ['pwsh', 'bash', 'read_image', 'job_list', 'job_output', 'job_kill'] },
]

/** restrict 安全名单（仅确定 global 的工具；engram/scope-local 不受 restrict 门控）。 */
const GLOBAL_SAFE = [
  'read', 'write', 'edit', 'glob', 'grep', 'web_search', 'ask_user_question',
  'todo_write', 'exit_plan_mode', 'pwsh', 'bash', 'read_image',
  'job_list', 'job_output', 'job_kill', 'str_replace_editor',
  // P0-2: 二级披露/自查工具（bootstrap 注册，预设层=继承面会被 agent 层 restrict 过滤——必须入 allow）
  'tools_catalog', 'tools_help', 'dev_router_status', 'dev_router_mode',
  // P1-1: 记忆/知识工具（engram-relay 注入的 global 工具——restrict 过滤后 SDK 不含 → 声明与事实脱节）
  'engram_recall', 'engram_store', 'engram_propose', 'engram_confirm', 'engram_reject',
  'engram_open', 'engram_search', 'engram_link', 'engram_update', 'engram_remove',
  'engram_promote', 'engram_status', 'engram_verify', 'engram_respond',
]

/** 阶段解锁指引（注入到用户消息后）。 */
/** 开局引导：每个会话只注入一次；之后阶段由 agent 自主路由，不再注入任何指引。 */
const START_GUIDE =
  '\n\nBootstrap (once per session): this is a progressive tool-unlock session — tools open in phases like a leveling game. '
  + 'Unlock order: understanding (read/glob/grep/web_search/ask_user_question) → planning (todo_write) → development (write/edit/str_replace_editor) → verification (pwsh/bash/read_image/jobs). '
  + 'Your current phase and unlocked tools are always visible in the system prompt (router-stage section) and via dev_router_status. '
  + 'You route yourself: to advance, use a tool of the next tier (it is pre-unlocked for you to try), or state that the current phase is done. '
  + 'This guide appears only once; after this, no phase messages are injected.'

/** 阶段状态（持久化）：session id -> { stage: 0..3, guided: 开局引导是否已注入 }。 */
const stageFile = () => process.env.DSH_ROUTER_STAGE_FILE || join(homedir(), '.dsh', 'router-standard', 'stages.json')
let stageCache = null // { file, state } — 按文件路径缓存，env 切换（测试）自动重载

function ensureStage() {
  const file = stageFile()
  if (stageCache === null || stageCache.file !== file) {
    stageCache = { file, state: loadStageState() }
  }
  return stageCache.state
}

function loadStageState() {
  try {
    const parsed = JSON.parse(readFileSync(stageFile(), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
      const out = {}
      for (const [sid, st] of Object.entries(parsed.sessions)) {
        const stage = Number(st?.stage)
        if (Number.isInteger(stage) && stage >= 0 && stage <= 3) {
          out[sid] = { stage, guided: st?.guided === true }
        }
      }
      return out
    }
  } catch { /* first run or unreadable: start empty */ }
  return {}
}

function saveStageState() {
  try {
    mkdirSync(dirname(stageFile()), { recursive: true })
    const sessions = Object.fromEntries(Object.entries(ensureStage()).slice(-1000))
    writeFileSync(stageFile(), JSON.stringify({ version: 2, savedAt: new Date().toISOString(), sessions }, null, 2), 'utf8')
  } catch { /* persistence failure: keep working in memory */ }
}

function sessionStage(sid) {
  const st = (ensureStage()[sid] ??= { stage: 0, guided: false })
  return st.stage
}

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
      'run_code 内通过 await tools.<name>(args) 调用任意工具（SDK 按需解析签名）；tools_catalog / tools_help 可查询完整清单与用法。',
    ]
    return { ...sdk, text: lines.join('\n') }
  }

  /** 按当前阶段收紧 restrict（执行层门控；PTC 下 SDK 调用同样受限）。 */
  function applyStageRestrict(agent, stage) {
    try {
      const toolsSvc = agent.ctx.get('tools')
      if (toolsSvc && typeof toolsSvc.restrict === 'function') {
        // 预放一档：下一阶段工具可见可用（通关式渐进解锁），使用后即推进
        const allowed = new Set(STAGES.slice(0, Math.min(stage + 2, STAGES.length)).flatMap((s) => s.tools))
        toolsSvc.restrict({ allow: [...allowed].filter((t) => GLOBAL_SAFE.includes(t)) })
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
    const stage = sessionStage(session.id)

    // 首轮/未 promoted：RL 句 + 披露声明 + 泄压引导（轻 system）
    const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))
    const stageSection = {
      name: 'router-stage',
      order: 1,
      text: 'Current phase: ' + STAGES[stage].name + ' (' + stage + '/3). Unlocked tools: '
        + STAGES.slice(0, Math.min(stage + 2, STAGES.length)).flatMap((s) => s.tools).join(', ')
        + ' (next tier pre-unlocked).\nPhase is self-routed state: you decide when to advance — '
        + 'use a next-tier tool or state that the current phase is done. dev_router_status shows the live state.',
    }
    const baseSections = planSection
      ? [planSection, { name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL + PRESSURE_GUIDE, order: 0 }, stageSection]
      : [{ name: 'router-persona', text: RL_PERSONA + '\n\n' + PROGRESSIVE_DECL + PRESSURE_GUIDE, order: 0 }, stageSection]

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
      // 渐进披露下 shell 是阶段工具（验证阶段解锁）——缺失是正常态，放行。
      if (shell === null) {
        return { ...assembled, sections: baseSections, contexts: [] }
      }
      const core = new Set(['str_replace_editor', shell, 'tools_catalog', 'tools_help'])
      return { ...assembled, sections: baseSections, contexts: [], tools: assembled.tools.filter((tool) => core.has(tool.name)) }
    }

    // promoted：官方完整 sections 回流 + persona 保持 RL 句 + 全目录（阶段 restrict 保留到验证完成）
    const sections = (assembled.sections || []).map((s) =>
      /persona/i.test(s.name) ? { ...s, text: RL_PERSONA } : s
    )
    sections.push(stageSection)
    applyStageRestrict(agent, stage)
    return { ...assembled, sections, contexts: [] }
  })

  // ── 自主路由（pre-step）：开局引导仅一次；之后只推进阶段，不再注入指引 ──
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    if (agent === undefined || agent.session === undefined || agent.inbox === undefined) return decision
    const userMsg = messages.find((m) => m.role === 'user' && m.source?.kind === 'user')
    if (userMsg === undefined) return decision
    const text = extractText(userMsg)
    if (!text.trim()) return decision

    const sid = agent.session.id
    const st = (ensureStage()[sid] ??= { stage: 0, guided: false })

    // 开局引导：每个会话只注入一次（标记持久化，关闭/恢复会话不重放）
    if (!st.guided) {
      st.guided = true
      saveStageState()
      try {
        agent.inbox.append('next-step', {
          id: 'router-start-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          role: 'user',
          source: { kind: 'plugin', plugin: 'router-bootstrap' },
          content: [{ type: 'text', text: START_GUIDE }],
        })
      } catch { /* duplicate/ordering races: skip */ }
      return decision
    }

    // 阶段推进（自主）：调用了下一档工具 / 用户文本信号 → 解锁下一档
    const events = agent.session.events || []
    // P0-1: PTC 底座下嵌套调用记录为 tool/code-dispatch(-start)（data.name 顶层）——
    // 三种事件都提取（用户实测：只认 tool/call 时阶段推进失效，永远 0/3）
    const toolNames = events
      .filter((e) => ['tool/call', 'tool/code-dispatch', 'tool/code-dispatch-start'].includes(e.type))
      .map((e) => e.data?.name || e.data?.toolName || '')
    const nextStage = advanceStage(st.stage, toolNames, text)
    if (nextStage > st.stage) {
      st.stage = nextStage
      applyStageRestrict(agent, nextStage)
      saveStageState()
    }
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
      const stage = sessionStage(session.id)
      const modelId = sessionModels.get(session.id)?.model ?? currentAgent()?.options?.model
      return [
        `router=standard (渐进披露 v0.9, self-routed)`,
        `phase=${STAGES[stage].name}（阶段 ${stage}/3）`,
        `persisted=${Object.hasOwn(ensureStage(), session.id)}`,
        `unlocked=[${STAGES.slice(0, Math.min(stage + 2, STAGES.length)).flatMap((s) => s.tools).join(', ')}] (next tier pre-unlocked)`,
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
