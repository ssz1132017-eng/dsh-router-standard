/**
 * Real-assembly-chain integration tests for router-bootstrap (v0.3.0).
 *
 * Drives the ACTUAL preset code through the DeepSeek Harness event ordering,
 * taken from `@deepseek-ai/dsh-agent-loop` preStep/turn (verified against
 * 0.1.0-rc.7):
 *
 *   inbox.claim()                       → emits `agent/inbox/claimed` per message
 *   systemPrompt.assemble(...)          → `system-prompt/assemble` waterfall
 *   dispatch.waterfall("agent/pre-step")→ `agent/pre-step` waterfall
 *   session.append('user/message', ...) → `session/event` (per decision.messages)
 *   step(assembly)                      → model request (NOT simulated here)
 *
 * These tests exist because pure-function tests could not see the first-turn
 * classification hole (#13), the dead `session/event` guidance channel
 * (#34/#36), the missing `extractText`/`bandOf` imports (#11), or the extra
 * API call manufactured by inbox re-append guidance (#55).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyStandard } from './preset/router-standard/router-bootstrap.mjs'
import { apply as applySpec } from './preset/router-spec/router-bootstrap-v1.mjs'
import { classifyTask, sessionMode } from './preset/router-standard/router-core.mjs'

// ── minimal Cordis-shaped context ──────────────────────────────────────────

function makeHarness(applyFn, config) {
  const listeners = new Map()
  const registeredTools = []
  const agentRef = { current: undefined }
  const ctx = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(fn)
      return () => {}
    },
    effect(fn) { fn() },
    get(name) { return name === 'agent' ? agentRef.current : undefined },
    tools: { register(tool) { registeredTools.push(tool) } },
    llm: { stream() { throw new Error('llm.stream must not be called in integration tests') } },
  }
  applyFn(ctx, config)
  return {
    ctx, listeners, registeredTools, agentRef,
    emit(name, ...args) {
      for (const fn of listeners.get(name) ?? []) fn(...args)
    },
    async assemble(initial, context) {
      const fns = listeners.get('system-prompt/assemble') ?? []
      const run = async (i) => (i >= fns.length ? initial : fns[i](initial, context, () => run(i + 1)))
      return run(0)
    },
    async preStep(payload) {
      const fns = listeners.get('agent/pre-step') ?? []
      const base = { kind: 'enter', messages: [...payload.messages] }
      const run = async (i) => (i >= fns.length ? base : fns[i](payload, () => run(i + 1)))
      return run(0)
    },
  }
}

// ── fixtures ───────────────────────────────────────────────────────────────

const SECTIONS = [
  { name: 'harness-identity', text: 'identity', order: -100 },
  { name: 'persona', text: 'You are a helpful software engineer assistant.', order: 0 },
  { name: 'plan-mode', text: 'You are in plan mode.', order: -50 },
  { name: 'tool-guidance', text: 'guidance', order: 100 },
]

const TOOLS = [
  { name: 'phase_begin' }, { name: 'bash' }, { name: 'pwsh' }, { name: 'str_replace_editor' },
  { name: 'read' }, { name: 'write' }, { name: 'edit' }, { name: 'glob' }, { name: 'grep' },
]

function baseAssembled() {
  return {
    sections: SECTIONS.map((s) => ({ ...s })),
    tools: TOOLS.map((t) => ({ ...t })),
    contexts: [],
    variables: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  }
}

function userMessage(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

function makeSession(events = []) {
  return { id: `session-${Math.random().toString(36).slice(2, 10)}`, header: {}, events: [...events] }
}

/** Mirror the loop: claim → assemble → pre-step, then persist decision.messages. */
async function runFirstStep(h, { message, session }) {
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  h.agentRef.current = agent
  h.emit('agent/inbox/claimed', { agent, message })
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  const claimed = [message]
  const decision = await h.preStep({ agent, messages: claimed, turn: 1, step: 1, signal: undefined })
  for (const message of decision.messages) session.events.push({ type: 'user/message', data: message })
  return { agent, assembled, decision }
}

// ── first-turn classification (#13) ────────────────────────────────────────

test('first request: RL persona + phase_begin as the only first-turn tool (v0.9)', async () => {
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const build = userMessage('m1', '从零开发一个马里奥网页游戏，生成完整实现，构建可运行的网站应用')
  assert.equal(classifyTask(build.content[0].text), 1) // react

  const { assembled, decision } = await runFirstStep(h, { message: build, session })

  // v0.9 self-routed: RL persona + progressive disclosure gate —— 首轮只有 phase_begin
  assert.match(assembled.sections.find((s) => s.name === 'router-persona').text, /^You are a helpful software engineer assistant\./)
  assert.ok(!assembled.sections.some((s) => s.name === 'router-stage'), 'stage section appears only after phase_begin/promotion')
  assert.deepEqual(assembled.tools.map((t) => t.name), ['phase_begin'])
  assert.deepEqual(assembled.contexts, [])
  // no injection in the harness (no inbox): the decision stays on the real message
  assert.deepEqual(decision.messages.map((m) => m.id), ['m1'])
})

test('phase_begin injects the bootstrap guide exactly once and persists guided (v0.9)', async () => {
  process.env.DSH_ROUTER_STAGE_FILE = tmpStageFile()
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const restrictCalls = []
  const agent = {
    session,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    inbox: { append(_kind, msg) { appends.push(msg) } },
    ctx: { get(name) { return name === 'tools' ? { restrict(cfg) { restrictCalls.push(cfg) } } : undefined } },
  }
  h.agentRef.current = agent
  await h.assemble(baseAssembled(), { agent, scope: agent })
  const begin = h.registeredTools.find((t) => t.name === 'phase_begin')
  assert.ok(begin, 'phase_begin registered')
  const first = await begin.execute()
  assert.match(String(first), /session started/)
  assert.equal(appends.length, 1, 'bootstrap guide appended once')
  assert.equal(appends[0].source.plugin, 'router-bootstrap')
  assert.match(appends[0].content[0].text, /Bootstrap \(once per session\)/)
  const again = await begin.execute()
  assert.match(String(again), /already started/)
  assert.equal(appends.length, 1, 'no duplicate bootstrap guide')
  const disk = JSON.parse(readFileSync(process.env.DSH_ROUTER_STAGE_FILE, 'utf8'))
  assert.equal(disk.sessions[session.id].guided, true)
  assert.ok(restrictCalls.length >= 1 && restrictCalls[0].allow.includes('todo_write'), 'stage 0 pre-unlocks planning tier')
})

test('plugin-origin claimed messages never pin the band or receive guides', async () => {
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const approval = { id: 'a1', role: 'user', source: { kind: 'plugin', plugin: 'user-approval' }, content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never"' }] }
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  h.agentRef.current = agent
  // Real chain: next-step plugin messages are claimed BEFORE the next-turn user message.
  const fix = userMessage('m4', '修复这个仓库里的 bug')
  h.emit('agent/inbox/claimed', { agent, message: approval })
  h.emit('agent/inbox/claimed', { agent, message: fix })
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  const decision = await h.preStep({ agent, messages: [approval, fix], turn: 1, step: 1 })
  // Classification comes from the REAL user message (plugin messages never pin the band)
  assert.equal(sessionMode({ events: [{ type: 'user/message', data: approval }] }), 'weak') // approval alone would be weak
  assert.match(assembled.sections.find((s) => s.name === 'router-persona').text, /^You are a helpful software engineer assistant\./)
  assert.deepEqual(decision.messages.map((m) => m.id), ['a1', 'm4']) // no bootstrap guide for plugin-origin messages
})

// ── promotion ──────────────────────────────────────────────────────────────

test('standard preset: after the first tool/call the router keeps the full surface + stage state (v0.9)', async () => {
  const h = makeHarness(applyStandard, {})
  const session = makeSession([
    { type: 'user/message', data: userMessage('m6', '从零开发一个马里奥网页游戏') },
    { type: 'tool/call', data: {} },
  ])
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  h.agentRef.current = agent
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  assert.equal(assembled.sections.length, SECTIONS.length + 3, 'official sections + router-stage/decl/pressure (v1.3)')
  assert.ok(assembled.sections.some((s) => s.name === 'router-stage'), 'stage state stays visible after promotion')
  assert.ok(assembled.sections.some((s) => s.name === 'router-decl'), 'progressive declaration persists after promotion')
  assert.ok(assembled.sections.some((s) => s.name === 'router-pressure'), 'pressure guide persists after promotion')
  assert.deepEqual(assembled.contexts, [])
  assert.ok(assembled.tools.length === TOOLS.length, 'full tool catalog exposed')
  assert.match(assembled.sections.find((s) => s.name === 'persona').text, /^You are a helpful software engineer assistant\.$/)
})

test('spec preset (routerMode: standard): RL first turn, then full assembly returns (#44)', async () => {
  const h = makeHarness(applySpec, { routerMode: 'standard' })
  const session = makeSession()
  const build = userMessage('m7', '从零开发一个马里奥网页游戏')
  const { assembled } = await runFirstStep(h, { message: build, session })
  // RL-interface first turn
  assert.deepEqual(assembled.sections.map((s) => s.name), ['plan-mode', 'router-persona'])
  assert.deepEqual(assembled.tools.map((t) => t.name), ['pwsh', 'str_replace_editor'])
  assert.deepEqual(assembled.contexts, [])

  // promoted: the router stops touching the assembly (full sections restored)
  session.events.push({ type: 'tool/call', data: {} })
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  h.agentRef.current = agent
  const original = baseAssembled()
  const promoted = await h.assemble(original, { agent, scope: agent })
  assert.equal(promoted, original, 'promoted assembly must be returned untouched')
})

test('spec preset (routerMode: spec): classified persona over the full section list', async () => {
  const h = makeHarness(applySpec, { routerMode: 'spec' })
  const session = makeSession()
  const build = userMessage('m8', '从零开发一个马里奥网页游戏')
  const { assembled } = await runFirstStep(h, { message: build, session })
  assert.match(assembled.sections.find((s) => s.name === 'router-persona').text, /hands-on software engineer/)
  assert.equal(assembled.sections.length, SECTIONS.length)
  assert.deepEqual(assembled.tools.map((t) => t.name), ['pwsh', 'read', 'write', 'edit'])
})

// ── resume safety ──────────────────────────────────────────────────────────

test('resume: a guide already in the durable transcript is never injected twice', async () => {
  const h = makeHarness(applyStandard, {})
  const m = userMessage('m9', '今天天气怎么样')
  const session = makeSession([
    { type: 'user/message', data: m },
    { type: 'user/message', data: { id: 'router-guide-m9', role: 'user', source: { kind: 'plugin', plugin: 'router-bootstrap' }, content: [{ type: 'text', text: 'guide' }] } },
  ])
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  h.agentRef.current = agent
  const decision = await h.preStep({ agent, messages: [m], turn: 2, step: 1 })
  assert.deepEqual(decision.messages.map((x) => x.id), ['m9'], 'no duplicate guide on resume')
})

// ── legacy session/event capture only ──────────────────────────────────────

test('no session/event listener: legacy emit is a no-op, never appends to the inbox (#55)', async () => {
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const inbox = { append() { throw new Error('inbox.append must not be called from session/event') } }
  const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, inbox }
  h.agentRef.current = agent
  h.emit('session/event', session, { type: 'user/message', data: userMessage('m10', '今天天气怎么样') })
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  assert.match(assembled.sections.find((s) => s.name === 'router-persona').text, /^You are a helpful software engineer assistant\./)
})

// ── dev tools register ─────────────────────────────────────────────────────

test('router visibility tools are registered', () => {
  const h = makeHarness(applyStandard, {})
  const names = h.registeredTools.map((t) => t.name)
  assert.ok(names.includes('tools_catalog'))
  assert.ok(names.includes('tools_help'))
  assert.ok(names.includes('dev_router_status'))
  assert.ok(names.includes('dev_router_mode'))
})

// ── v0.9 self-routed phases ─────────────────────────────────────────────────

function tmpStageFile() {
  const dir = mkdtempSync(join(tmpdir(), 'router-stage-'))
  return join(dir, 'stages.json')
}

function makeStageAgent(session, appends) {
  const restrictCalls = []
  return {
    session,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    inbox: { append(_kind, msg) { appends.push(msg) } },
    ctx: { get() { return { restrict(cfg) { restrictCalls.push(cfg) } } } },
    _restrictCalls: restrictCalls,
  }
}

test('v0.9: read-only next-tier tool does not advance the phase; mutating does', async () => {
  const file = tmpStageFile()
  process.env.DSH_ROUTER_STAGE_FILE = file
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const agent = makeStageAgent(session, appends)
  h.agentRef.current = agent
  // stage 0 → 1 via todo_write
  session.events.push({ type: 'tool/call', data: { name: 'todo_write', arguments: '{}' }, time: Date.now() })
  await h.preStep({ agent, messages: [userMessage('v1', '先看计划')], turn: 1, step: 1 })
  let disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.sessions[session.id].stage, 1, 'todo_write advances to planning')
  // str_replace_editor view 是读操作：不推进
  session.events.push({ type: 'tool/call', data: { name: 'str_replace_editor', arguments: JSON.stringify({ command: 'view', path: 'README.md' }) }, time: Date.now() })
  await h.preStep({ agent, messages: [userMessage('v2', '读文件')], turn: 2, step: 1 })
  disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.sessions[session.id].stage, 1, 'view must not advance to development')
  // mutating str_replace 推进到开发
  session.events.push({ type: 'tool/call', data: { name: 'str_replace_editor', arguments: JSON.stringify({ command: 'create', path: 'x.txt', file_text: 'x' }) }, time: Date.now() })
  await h.preStep({ agent, messages: [userMessage('v3', '开始写')], turn: 3, step: 1 })
  disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.sessions[session.id].stage, 2, 'mutating editor advances to development')
})

test('v0.9: resume keeps the phase and never re-injects the bootstrap guide', async () => {
  const file = tmpStageFile()
  writeFileSync(file, JSON.stringify({ version: 2, sessions: { 'resume-session': { stage: 2, guided: true } } }))
  process.env.DSH_ROUTER_STAGE_FILE = file
  const h = makeHarness(applyStandard, {})
  const session = { id: 'resume-session', header: {}, events: [
    { type: 'user/message', data: userMessage('r1', '写一个工具') },
    { type: 'tool/call', data: { name: 'write' } },
  ] }
  const appends = []
  const agent = makeStageAgent(session, appends)
  h.agentRef.current = agent
  const decision = await h.preStep({ agent, messages: [userMessage('r2', '继续')], turn: 3, step: 1 })
  assert.equal(appends.length, 0, 'resume: zero injection')
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  assert.match(assembled.sections.find((s) => s.name === 'router-stage').text, /开发 \(2\/3\)/)
})

test('v0.9: using a next-tier tool advances the phase and persists it', async () => {
  const file = tmpStageFile()
  process.env.DSH_ROUTER_STAGE_FILE = file
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const agent = makeStageAgent(session, appends)
  h.agentRef.current = agent
  await h.preStep({ agent, messages: [userMessage('v3', '开始')], turn: 1, step: 1 })
  session.events.push({ type: 'tool/call', data: { name: 'todo_write' } })
  await h.preStep({ agent, messages: [userMessage('v4', '继续')], turn: 2, step: 1 })
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.sessions[session.id].stage, 1, 'phase persisted to disk')
  const assembled = await h.assemble(baseAssembled(), { agent, scope: agent })
  assert.match(assembled.sections.find((s) => s.name === 'router-stage').text, /拟合方案 \(1\/3\)/)
})

test('v1.6.1: shim dev_page_check output contract — object schema + render + full-shape result (regression: value must be a string)', async () => {
  process.env.DSH_ROUTER_STAGE_FILE = tmpStageFile()
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const shimTools = []
  const agent = {
    session,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    inbox: { append(_k, m) { appends.push(m) } },
    ctx: {
      get(name) {
        if (name === 'tools') return {
          restrict() {}, register(def) { shimTools.push(def) }, schemas() { return [] },
        }
        return undefined
      },
    },
  }
  h.agentRef.current = agent
  await h.assemble(baseAssembled(), { agent, scope: agent })
  const begin = h.registeredTools.find((t) => t.name === 'phase_begin')
  assert.ok(begin, 'phase_begin registered')
  await begin.execute()
  const def = shimTools.find((d) => d.name === 'dev_page_check')
  assert.ok(def, 'shim dev_page_check registered through installMetaShim')
  assert.ok(def.output && def.output.schema && def.output.schema.type === 'object', 'shim output schema must be the object schema (v1.6.1)')
  assert.equal(typeof def.output.render, 'function', 'shim output render must be present')
  const v = await def.execute({ url: 'http://127.0.0.1:9/unreachable', timeoutMs: 1000 })
  // harness ctx 无 subprocess → pageFail 分支：12 字段形状完整（v1.6.1→v1.7 内容）
  for (const k of Object.keys(v)) {
    assert.ok(['ok', 'exitCode', 'timedOut', 'settleError', 'shot', 'domText', 'stderrTail', 'title', 'consoleTail', 'selectorText', 'jsOutput', 'jsError'].includes(k), 'unexpected key: ' + k)
  }
  assert.equal(v.ok, false)
  assert.match(v.settleError, /subprocess/)
  assert.equal(typeof v.exitCode, 'number')
  // js-only 模式经 shim 路径也可用（不启动浏览器）
  const jsv = await def.execute({ js: 'return Math.max(1, 7, 3)' })
  assert.equal(jsv.ok, true)
  assert.match(jsv.jsOutput, /=> 7/)
})

test('v1.6.1: shim zero-arg tools keep string output (catalog/status unchanged)', async () => {
  process.env.DSH_ROUTER_STAGE_FILE = tmpStageFile()
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const shimTools = []
  const agent = {
    session,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    inbox: { append(_k, m) { appends.push(m) } },
    ctx: {
      get(name) {
        if (name === 'tools') return {
          restrict() {}, register(def) { shimTools.push(def) }, schemas() { return [] },
        }
        return undefined
      },
    },
  }
  h.agentRef.current = agent
  await h.assemble(baseAssembled(), { agent, scope: agent })
  await h.registeredTools.find((t) => t.name === 'phase_begin').execute()
  const status = shimTools.find((d) => d.name === 'dev_router_status')
  assert.ok(status && status.output.schema.type === 'string', 'string-output tools keep string schema')
})

test('v1.6: restrict pre-unlocks two tiers (stage 0 → write available; verification stays locked)', async () => {
  process.env.DSH_ROUTER_STAGE_FILE = tmpStageFile()
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const agent = makeStageAgent(session, appends)
  h.agentRef.current = agent
  await h.assemble(baseAssembled(), { agent, scope: agent })
  const begin = h.registeredTools.find((t) => t.name === 'phase_begin')
  assert.ok(begin, 'phase_begin registered')
  await begin.execute()
  const first = agent._restrictCalls[0]
  assert.ok(first, 'restrict called on phase_begin')
  assert.ok(first.allow.includes('todo_write'), 'planning tier pre-unlocked at stage 0')
  assert.ok(first.allow.includes('write'), 'development tier pre-unlocked at stage 0 (two tiers, v1.6)')
  assert.ok(!first.allow.includes('pwsh'), 'verification tier stays locked at stage 0')
})

test('v0.9: final phase releases the restrict (no new restriction)', async () => {
  process.env.DSH_ROUTER_STAGE_FILE = tmpStageFile()
  const h = makeHarness(applyStandard, {})
  const session = makeSession()
  const appends = []
  const agent = makeStageAgent(session, appends)
  h.agentRef.current = agent
  await h.assemble(baseAssembled(), { agent, scope: agent })
  const begin = h.registeredTools.find((t) => t.name === 'phase_begin')
  const advance = h.registeredTools.find((t) => t.name === 'phase_advance')
  assert.ok(begin && advance, 'phase tools registered')
  await begin.execute()
  await advance.execute({ reason: 'to 1' })
  await advance.execute({ reason: 'to 2' })
  await advance.execute({ reason: 'to 3' })
  // 阶段 0/1/2 各设一次 restrict；阶段 3 释放（不再新增）
  assert.equal(agent._restrictCalls.length, 3, 'stage 3 must not install another restriction')
})
