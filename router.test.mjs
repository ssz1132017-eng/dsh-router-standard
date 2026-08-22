/** Router classifier + continuous mode tests. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { writeFileSync, rmSync } from 'node:fs'
import {
  classifyTask, personaFor, coreFor, bandFor, testinessFor, parseMode, applyPersona,
  isFlashModel, extractText, sessionMode,
} from './preset/router-standard/router-core.mjs'
import { autoAdvance, filterToolGuidance, markerFor, runtimeMark, runtimeCallable, deliveryCheck, paramHint, pageCheckRun, pageRunnerPath, normalizePageUrl, pageFail, runSandboxJs, stripDomNoise, extractTitle, extractSelectorText, extractConsoleLines } from './preset/router-standard/router-bootstrap.mjs'

test('react: greenfield/build tasks map to react band', () => {
  assert.equal(bandFor(classifyTask('需要本地开发一个马里奥网页小游戏，参考经典原版')), 'react')
  assert.equal(bandFor(classifyTask('帮我写一个 Python 脚本处理 CSV')), 'react')
  assert.equal(bandFor(classifyTask('从零搭建一个网站')), 'react')
})

test('spec: maintenance/fix tasks map to spec band', () => {
  assert.equal(bandFor(classifyTask('修复这个仓库里的 bug')), 'spec')
  assert.equal(bandFor(classifyTask('为什么登录一直报错，帮我排查')), 'spec')
  assert.equal(classifyTask('修复这个仓库里的 bug'), 0)
})

test('mixed task lands in react band (net react keywords)', () => {
  assert.equal(bandFor(classifyTask('帮我开发一个小游戏然后修复里面的 bug')), 'react')
})

test('unmatched defaults to weak (internal routing)', () => {
  assert.equal(classifyTask('今天天气怎么样'), 'weak')
  assert.equal(bandFor('weak'), 'weak')
})

test('ties default to weak (internal routing)', () => {
  assert.equal(classifyTask('帮我开发一个小游戏然后修复里面的 bug'), 1) // net react wins
  assert.equal(classifyTask('开发并修复'), 'weak') // tie → weak
})

test('issue #1: plugin-generated nested user/message shape still classifies', () => {
  // 注入器 startIngest 的旧 seed 形状（data.message 嵌套）：提取必须解包，
  // 否则构建/修复任务误入 weak。
  const nested = { message: { kind: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把目录里的内容内化成 DSH 插件并构建注入' }] } }
  assert.match(extractText(nested), /内化成/)
  assert.equal(bandFor(classifyTask(extractText(nested))), 'react')
  // 标准形状不受影响
  const flat = { kind: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '修复这个仓库里的 bug' }] }
  assert.equal(extractText(flat), '修复这个仓库里的 bug')
  assert.equal(bandFor(classifyTask(extractText(flat))), 'spec')
  // sessionMode 用首条 user/message（嵌套形状）
  const session = { events: [{ type: 'user/message', data: nested }] }
  assert.equal(sessionMode(session), 1)
})

test('issue #13: sessionMode skips plugin-origin messages when pinning the band', () => {
  // 真实链路上首条落库的 user/message 常常是插件注入的（approval 通知、
  // runtime-context 快照、agent-instructions、router 引导），它们不能参与分类。
  const buildTask = { kind: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '从零开发一个马里奥网页游戏' }] }
  const approval = { kind: 'user', source: { kind: 'plugin', plugin: 'user-approval' }, content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never"' }] }
  const snapshot = { kind: 'user', source: { kind: 'plugin', plugin: 'runtime-context' }, content: [{ type: 'text', text: 'cwd snapshot' }] }
  const guide = { id: 'router-guide-x', kind: 'user', source: { kind: 'plugin', plugin: 'router-bootstrap' }, content: [{ type: 'text', text: 'Router: classify this task now' }] }
  // 插件消息在前、真实用户消息在后 → 必须按真实消息分类（react）
  assert.equal(sessionMode({ events: [
    { type: 'user/message', data: approval },
    { type: 'user/message', data: snapshot },
    { type: 'user/message', data: guide },
    { type: 'user/message', data: buildTask },
  ] }), 1)
  // 只有插件消息 → 退化到首条 user/message（旧行为，不抛错）
  assert.equal(sessionMode({ events: [{ type: 'user/message', data: approval }] }), 'weak')
  // 无 source 的历史消息按用户消息处理
  const legacy = { kind: 'user', content: [{ type: 'text', text: '修复这个仓库里的 bug' }] }
  assert.equal(sessionMode({ events: [{ type: 'user/message', data: legacy }] }), 0)
})

test('weak persona is model-specific (P11/P24)', () => {
  const pro = personaFor('weak', 'deepseek-v4-pro')
  const flash = personaFor('weak', 'deepseek-v4-flash')
  assert.ok(pro.includes('decide the task type (build or fix)'))
  assert.ok(pro.includes('You are a helpful software engineer assistant.'))
  assert.ok(!pro.includes('review what you have already done')) // P24: anchors hurt Pro
  assert.ok(flash.includes('decide the task type (build or fix)'))
  assert.ok(flash.includes('review what you have already done')) // anchors help flash
  assert.notEqual(pro, flash)
  assert.equal(personaFor('weak', 'deepseek-v4-flash'), personaFor('weak', 'deepseek-v4-flash'))
  assert.equal(isFlashModel('deepseek-v4-flash'), true)
  assert.equal(isFlashModel('deepseek-v4-pro'), false)
})

test('parseMode accepts weak', () => {
  assert.equal(parseMode('weak'), 'weak')
  assert.equal(parseMode('router'), 'weak')
})

test('persona quantizes to three measured bands', () => {
  assert.equal(personaFor(0), 'You are a helpful software engineer assistant.')
  assert.equal(personaFor(0.1), 'You are a helpful software engineer assistant.')
  assert.ok(personaFor(0.3).includes('Work directly'))
  assert.ok(!personaFor(0.3).includes('test harnesses'))
  assert.ok(personaFor(1).includes('hands-on'))
  assert.ok(personaFor(1).includes('do not build test harnesses'))
})

test('core tool surface varies by band', () => {
  assert.deepEqual(coreFor(0), ['read', 'edit', 'glob', 'grep'])
  assert.deepEqual(coreFor(1), ['read', 'write', 'edit'])
  assert.deepEqual(coreFor(0.3), ['read', 'edit', 'write', 'glob', 'grep'])
})

test('band mapping matches the measured phase transition', () => {
  assert.equal(bandFor(0.1), 'spec') // stable spec region
  assert.equal(bandFor(0.2), 'mixed') // unstable band (display name)
  assert.equal(bandFor(0.4), 'mixed')
  assert.equal(bandFor(0.5), 'react') // stable react region
  assert.equal(bandFor(0.99), 'react')
})

test('testiness rises toward spec', () => {
  assert.equal(testinessFor(1), 'suppressed')
  assert.equal(testinessFor(0), 'normal')
  assert.equal(testinessFor(0.3), 'light')
})

test('parseMode accepts bands, percents, and decimals', () => {
  assert.equal(parseMode('spec'), 0)
  assert.equal(parseMode('react'), 1)
  assert.equal(parseMode('balanced'), 0.3)
  assert.equal(parseMode('70'), 0.7)
  assert.equal(parseMode('0.3'), 0.3)
  assert.equal(parseMode('auto'), 'auto')
  assert.equal(parseMode('nonsense'), null)
})

test('applyPersona replaces only the persona section (keeps plan-mode)', () => {
  const sections = [
    { name: 'harness-identity', text: 'x', order: -100 },
    { name: 'persona', text: 'old persona', order: 0 },
    { name: 'plan-mode', text: 'You are in plan mode.', order: -50 },
    { name: 'tool-guidance', text: 'y', order: 100 },
  ]
  const out = applyPersona(sections, 'new persona')
  const names = out.map((s) => s.name)
  assert.ok(names.includes('harness-identity'))
  assert.ok(names.includes('plan-mode'), 'plan-mode section must survive')
  assert.ok(names.includes('tool-guidance'))
  assert.ok(!names.includes('persona'), 'old persona section replaced')
  assert.equal(out.find((s) => s.name === 'router-persona').text, 'new persona')
})

test('applyPersona tolerates missing sections', () => {
  const out = applyPersona([], 'p')
  assert.deepEqual(out, [{ name: 'router-persona', text: 'p', order: 0 }])
})

test('autoAdvance: no false advance from "plan" in filenames or read-only editor views', () => {
  assert.equal(autoAdvance(0, [], 'STANDARD-PLAN.md 是美好期待'), 0)
  assert.equal(autoAdvance(1, [{ name: 'str_replace_editor', args: { command: 'view', path: 'README.md' } }], ''), 1)
  assert.equal(autoAdvance(1, [{ name: 'str_replace_editor', args: { command: 'str_replace', path: 'a.txt', old_str: 'x', new_str: 'y' } }], ''), 2)
})

test('autoAdvance: v1.6 直达语义 — 用哪档工具就跳到哪档；开发意图文本直达', () => {
  assert.equal(autoAdvance(0, [{ name: 'write', args: { file_path: 'x', content: 'y' } }], ''), 2)
  assert.equal(autoAdvance(1, [{ name: 'pwsh', args: { command: 'x' } }], ''), 3)
  assert.equal(autoAdvance(0, [{ name: 'todo_write', args: {} }], ''), 1)
  assert.equal(autoAdvance(0, [], '写一个 HTML 页面'), 2)
  assert.equal(autoAdvance(0, [{ name: 'str_replace_editor', args: { command: 'view', path: 'README.md' } }], '写一个 HTML'), 2, 'text intent still jumps even when the only tool was read-only')
  assert.equal(autoAdvance(3, [{ name: 'read_image', args: { file_path: 'x.png' } }], ''), 3)
})

test('filterToolGuidance: keeps only visible-tier tool guidance before delivery (v1.6 pre-unlock 2 tiers)', () => {
  const sections = [
    { name: 'tool:read', order: 100, text: 'r' },
    { name: 'tool:write', order: 100, text: 'w' },
    { name: 'tool:subagent', order: 100, text: 's' },
    { name: 'plan-mode', order: -50, text: 'p' },
    { name: 'tools:sdk', order: 150, text: 'sdk' },
  ]
  const full = new Set(['read', 'write', 'subagent'])
  // stage 0: read 当前档 + write（预放两档）→ 都保留；subagent 无阶段→锁定→裁
  const out0 = filterToolGuidance(sections, 0, full)
  assert.deepEqual(out0.map((s) => s.name), ['tool:read', 'tool:write', 'plan-mode', 'tools:sdk'])
  // subagent 仍裁
  assert.ok(!filterToolGuidance(sections, 1, full).some((s) => s.name === 'tool:subagent'))
  // delivery：不裁剪
  assert.equal(filterToolGuidance(sections, 3, full).length, sections.length)
  // 安全规则：后缀不属全量真实名 → 保留
  assert.ok(filterToolGuidance([{ name: 'tool:unknown-thing', text: 'x' }], 0, full).length === 1)
})

test('runtimeMark: 以运行时可见面为准（v1.9 根修——目录标注=SDK 真绑定）', () => {
  const fakeVisible = (names) => ({ view: () => ({ visible: new Map(names.map((n) => [n, {}])) }) })
  const svc = fakeVisible(['read', 'write', 'pwsh'])
  assert.equal(runtimeMark(svc, {}, 'read'), '可调')
  assert.equal(runtimeMark(svc, {}, 'pwsh'), '可调')
  assert.equal(runtimeMark(svc, {}, 'read_image'), '交付后') // 不在可见面 → 不谎报
  assert.equal(runtimeMark(fakeVisible(['tools_catalog']), {}, 'tools_catalog'), 'meta')
  assert.equal(runtimeMark(fakeVisible([]), {}, 'tools_catalog'), '交付后')
})
test('markerFor: 可调/交付后/meta/全量 semantics (v1.7 单语义化——预放≠不可调)', () => {
  assert.equal(markerFor('read', 0), '可调')
  assert.equal(markerFor('todo_write', 0), '可调')
  assert.equal(markerFor('write', 0), '可调') // stage+2 预放 = 可调（无行为差 → 单标记）
  assert.equal(markerFor('tools_catalog', 0), 'meta')
  assert.equal(markerFor('subagent', 0), '交付后')
  assert.equal(markerFor('read', 3), '全量')
})

test('runSandboxJs: 语法检查 + 纯逻辑执行（v1.7 本地 JS 引擎，零外部 node）', () => {
  const ok = runSandboxJs('const a = [1,2,3].map(x => x*2); console.log("sum", a.reduce((p,c)=>p+c,0)); return a.length')
  assert.equal(ok.ok, true)
  assert.match(ok.output, /sum 12/)
  const err = runSandboxJs('const = 3')
  assert.equal(err.ok, false)
  assert.match(err.error, /SyntaxError|Unexpected token/)
  const runtime = runSandboxJs('return nope()')
  assert.equal(runtime.ok, false)
  assert.match(runtime.error, /is not a function|ReferenceError|not defined|is not defined/)
})

test('dom 工具：strip/title/selector/console（v1.7）', () => {
  const html = '<html><head><title>G-SHOT-READY</title><style>body{color:red}</style></head><body><div id="metrics">sai 0.10 rad</div><div class="val">-8.21</div><script>var x=1</script></body></html>'
  assert.ok(!stripDomNoise(html).includes('color:red'))
  assert.ok(!stripDomNoise(html).includes('var x=1'))
  assert.equal(extractTitle(html), 'G-SHOT-READY')
  assert.match(extractSelectorText(html, '#metrics'), /sai 0\.10 rad/)
  assert.match(extractSelectorText(html, '.val'), /-8\.21/)
  const stderr = 'INFO:CONSOLE(12): "hello"\nERROR:CONSOLE(13): Uncaught TypeError: setLineDash\nUncaught ReferenceError: foo'
  const lines = extractConsoleLines(stderr)
  assert.match(lines, /console\[12\]: "hello"/)
  assert.match(lines, /Uncaught/)
})

test('paramHint: 参数名+类型速览消灭猜参数摩擦 (v1.4 → v1.5 带类型)', () => {
  assert.equal(paramHint({ type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } } }), 'params: pattern: string, path: string')
  assert.equal(paramHint({ properties: {} }), 'no params')
  assert.equal(paramHint({ type: 'object', properties: { content: { type: 'string' } } }), 'params: content: string')
  assert.equal(paramHint({ type: 'object', properties: { limit: { type: 'number', description: 'Maximum lines. Defaults to 2000.' } } }), 'params: limit: number≤2000')
  assert.match(paramHint(() => ({})), /tools_help/)
  assert.equal(paramHint(undefined), 'no params')
})

test('normalizePageUrl: 裸路径/中文路径/相对路径自动转 file:// (v1.6)', () => {
  assert.match(normalizePageUrl('D:\\黑洞\\index.html'), /^file:\/\/\/D:\/%E9%BB%91%E6%B4%9E\/index\.html$/)
  assert.match(normalizePageUrl('D:/黑洞/index.html'), /file:\/\/\/D:/)
  assert.match(normalizePageUrl('index.html'), /file:\/\//)
  assert.equal(normalizePageUrl('http://127.0.0.1:8080/?shot=probe'), 'http://127.0.0.1:8080/?shot=probe')
  assert.equal(normalizePageUrl('ftp://x'), 'ftp://x') // 非 http/file scheme 原样 → pageCheckRun 拒绝
})

test('pageCheckRun: 单飞锁（v1.9.1——并发只跑一个，杜绝 chrome 堆积）', async () => {
  const KEY = Symbol.for('router-standard.pageCheckBusy')
  const saved = globalThis[KEY]
  globalThis[KEY] = { v: true }
  try {
    const busy = await pageCheckRun({ get: () => ({ spawn() { throw new Error('must not spawn when busy') } }) }, { url: 'http://127.0.0.1:9/' })
    assert.equal(busy.ok, false)
    assert.match(busy.settleError, /single-flight/)
  } finally {
    if (saved === undefined) delete globalThis[KEY]
    else globalThis[KEY] = saved
  }
})
test('pageCheckRun: URL 校验 + fake subprocess smoke (v1.5 → v1.6.1 全分支形状)', async () => {
  // 输出契约形状断言（自写子集校验器，镜像 dsh-tools 的 output 校验：7 字段必需、类型、无额外属性）
  const assertPageShape = (v) => {
    assert.equal(typeof v, 'object')
    const allowed = new Set(['ok', 'exitCode', 'timedOut', 'settleError', 'shot', 'domText', 'stderrTail', 'title', 'consoleTail', 'selectorText', 'jsOutput', 'jsError'])
    for (const k of Object.keys(v)) assert.ok(allowed.has(k), 'unexpected key: ' + k)
    assert.equal(typeof v.ok, 'boolean')
    assert.equal(typeof v.exitCode, 'number')
    assert.equal(typeof v.timedOut, 'boolean')
    assert.equal(typeof v.settleError, 'string')
    assert.equal(typeof v.shot, 'string')
    assert.equal(typeof v.domText, 'string')
    assert.equal(typeof v.stderrTail, 'string')
    assert.equal(typeof v.title, 'string')
    assert.equal(typeof v.consoleTail, 'string')
    assert.equal(typeof v.selectorText, 'string')
    assert.equal(typeof v.jsOutput, 'string')
    assert.equal(typeof v.jsError, 'string')
  }
  // 失败分支（url 非法）
  const badUrl = await pageCheckRun({ get: () => undefined }, { url: 'ftp://x' })
  assert.equal(badUrl.ok, false)
  assertPageShape(badUrl)
  // 失败分支（无 subprocess 服务）
  const noSub = await pageCheckRun({ get: (n) => n === 'agent' ? {} : undefined }, { url: 'http://127.0.0.1:9/', timeoutMs: 1000 })
  assert.equal(noSub.ok, false)
  assert.match(noSub.settleError, /subprocess/)
  assertPageShape(noSub)
  // 失败分支（无法创建 temp profile：TMP 指向一个真实文件 → mkdir 必失败）
  const savedTmp = process.env.TMP
  try {
    process.env.TMP = fileURLToPath(import.meta.url)
    const noProfile = await pageCheckRun({ get: () => undefined }, { url: 'http://127.0.0.1:9/', timeoutMs: 1000 })
    assert.equal(noProfile.ok, false)
    assertPageShape(noProfile)
  } finally { process.env.TMP = savedTmp }
  // pageFail 直接构造
  assertPageShape(pageFail('boom'))
  // js-only 模式：不启动浏览器（v1.7）
  const jsr = await pageCheckRun({ get: () => { throw new Error('must not touch subprocess in js mode') } }, { js: 'return 6*9' })
  assert.equal(jsr.ok, true)
  assert.equal(jsr.exitCode, 0)
  assert.match(jsr.jsOutput, /=> 54/)
  assert.equal(jsr.jsError, '')
  const jsBad = await pageCheckRun({ get: () => { throw new Error('must not touch subprocess') } }, { js: 'const = 1' })
  assert.equal(jsBad.ok, false)
  assert.match(jsBad.jsError, /SyntaxError|Unexpected token/)
  assertPageShape(jsBad)
  // 成功路径（fake subprocess）
  const fake = {
    get(n) {
      if (n !== 'subprocess') return undefined
      return {
        spawn(spec) {
          return {
            done: Promise.resolve({ exitCode: 0 }),
            collected: {
              stdout: { readFrom: () => ({ text: '<!doctype html><html><body>GARGANTUA OK</body></html>' }) },
              stderr: { readFrom: () => ({ text: '' }) },
            },
            spec,
          }
        },
      }
    },
  }
  const r = await pageCheckRun(fake, { url: 'file:///x.html', domChars: 100 })
  assert.equal(r.ok, true)
  assert.match(r.domText, /GARGANTUA OK/)
  assert.match(r.shot, /\.dsh-shots/)
  assertPageShape(r)
  assert.equal(typeof pageRunnerPath(), 'string')
})
test('deliveryCheck: 交付 gate 检查清单（v1.11）', async () => {
  // 缺失路径 → FAIL + 证据
  const nofile = await deliveryCheck({ get: () => undefined }, { file: 'Z:\\\\no-such-file-xyz.html' })
  assert.equal(nofile.ok, false)
  assert.ok(nofile.checks.some((c) => c.name === 'file-exists' && !c.pass))
  // 临时有效文件 → 存在/非空/UTF-8 全 PASS（无 url 时不跑 smoke）
  const tmp = join(process.cwd(), '.t-delivery-probe.html')
  writeFileSync(tmp, '<!doctype html><html><head><title>OK</title></head><body>x</body></html>', 'utf8')
  try {
    const okr = await deliveryCheck({ get: () => undefined }, { file: tmp })
    assert.equal(okr.ok, true)
    assert.ok(okr.checks.every((c) => c.pass))
  } finally { rmSync(tmp, { force: true }) }
  // 非法 UTF-8 → encoding FAIL
  const bad = join(process.cwd(), '.t-bad.html')
  writeFileSync(bad, Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'utf8')
  try {
    const badr = await deliveryCheck({ get: () => undefined }, { file: bad })
    assert.equal(badr.ok, false)
    assert.ok(badr.checks.some((c) => c.name === 'encoding-utf8' && !c.pass))
  } finally { rmSync(bad, { force: true }) }
})

test('runtimeCallable: 与 SDK 绑定同源（v1.11）', () => {
  const svc = { view: () => ({ visible: new Map([['read', {}], ['write', {}], ['run_code', {}], ['subagent', {}]]) }) }
  const names = runtimeCallable(svc, {})
  assert.ok(names.includes('read') && names.includes('write'))
  assert.ok(!names.includes('run_code'))
  assert.ok(!names.includes('subagent'), '非阶段/非 meta 不列入 callable')
})