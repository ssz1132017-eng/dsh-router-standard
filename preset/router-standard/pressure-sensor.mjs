/**
 * pressure-sensor — 外置压力感应提醒（v0.1）
 *
 * 监测会话的推理压力信号，在"压力状态"下注入一条温和提醒：
 *   - 单步推理过长（chars 超阈值）
 *   - 推理流循环模式（but wait / actually / 重新确认 / 让我再 高频重复）
 *   - 连续多步无工具调用
 *
 * 设计哲学：提醒不是压制——模型想深想就深想（深度自主），传感器只在
 * 可观测的"压力信号"出现时给一个选择："若已足够则行动；若需更深则用
 * 泄压口（MAXential）结构化思考"。提醒经 pre-step 注入（缓存中性，
 * 与近场引导同通道），防重复（每步冷却）。
 */
import { appendFileSync } from 'node:fs'

export const name = 'pressure-sensor'

export const inject = ['systemPrompt']

const LOG = 'C:\\Users\\Eldwen\\.dsh\\pressure-sensor-debug.log'
function log(msg) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8') } catch { /* ignore */ }
}

// 压力阈值（可配置）
const CHARS_PER_STEP = 30000 // 单步推理字符阈值
const LOOP_PATTERN = /\b(but wait|actually|hold on|重新确认|让我再|再想想|hmm|等一下)\b/gi
const LOOP_HITS = 4 // 循环词阈值
const NO_TOOL_STEPS = 3 // 连续无工具调用步数阈值

/** 每会话压力状态。 */
const state = new Map() // session id -> { stepChars, loopHits, noToolSteps, lastGuideAt }

export function apply(ctx, config = {}) {
  const charsPerStep = Number(config.charsPerStep || CHARS_PER_STEP)
  const loopHits = Number(config.loopHits || LOOP_HITS)
  const noToolSteps = Number(config.noToolSteps || NO_TOOL_STEPS)

  // 跟踪每个 step 的推理流
  ctx.on('agent', async (agent, next) => {
    const r = await next()
    const sid = agent?.session?.id
    if (!sid) return r
    const st = state.get(sid) ?? { stepChars: 0, loopHits: 0, noToolSteps: 0, lastGuideAt: 0, stepNo: 0 }
    state.set(sid, st)
    return r
  })

  // reasoning-delta 累积（assistant/chunk 事件在 agent 上下文）
  ctx.on('assistant/chunk', (agent, event) => {
    const sid = agent?.session?.id
    if (!sid) return
    const st = state.get(sid)
    if (!st) return
    const chunk = event?.data?.chunk
    if (chunk?.type === 'reasoning-delta') {
      const t = chunk.text || ''
      st.stepChars += t.length
      st.loopHits += (t.match(LOOP_PATTERN) || []).length
    }
  })

  // step 边界：工具调用检测 + 压力评估
  ctx.on('agent', async (agent, next) => {
    const r = await next()
    const sid = agent?.session?.id
    const st = sid ? state.get(sid) : undefined
    if (!sid || !st) return r
    // step 结束信号：assistant/message 或 tool/call 后重置 stepChars
    // 简化：tool/call 出现 = 本步有行动
    return r
  })

  // 工具调用 = 行动信号（重置无行动计数）
  ctx.on('tool/call', (agent) => {
    const sid = agent?.session?.id
    const st = sid ? state.get(sid) : undefined
    if (!st) return
    st.noToolSteps = 0
  })

  // pre-step：评估压力并注入提醒（冷却 2 步）
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const sid = agent?.session?.id
    if (!sid || !agent.inbox) return decision
    const st = state.get(sid)
    if (!st) return decision

    // 评估信号
    const triggers = []
    if (st.stepChars > charsPerStep) triggers.push(`deep-reasoning ${st.stepChars} chars`)
    if (st.loopHits >= loopHits) triggers.push(`loop-pattern x${st.loopHits}`)
    st.noToolSteps += 1
    if (st.noToolSteps >= noToolSteps) triggers.push(`${st.noToolSteps} steps no action`)

    // 步推进
    st.stepNo += 1
    const cooled = st.stepNo - st.lastGuideAt >= 2

    if (triggers.length > 0 && cooled) {
      st.lastGuideAt = st.stepNo
      const guide =
        '\n\nPressure sensor: ' + triggers.join(', ') + '. '
        + 'Choice is ours: if reasoning has settled, act now (write / run_code the next step); '
        + 'if deeper thinking is needed, use the pressure valve (MAXential) — think a step, '
        + 'revise, branch + merge, complete when truly settled. Depth is our call.'
      try {
        agent.inbox.append('next-step', {
          id: 'pressure-guide-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          role: 'user',
          source: { kind: 'plugin', plugin: 'pressure-sensor' },
          content: [{ type: 'text', text: guide }],
        })
        log(`pressure guide injected (${sid}): ${triggers.join(', ')}`)
      } catch { /* skip */ }
    }

    // 步后重置
    st.stepChars = 0
    st.loopHits = 0
    return decision
  })
}
