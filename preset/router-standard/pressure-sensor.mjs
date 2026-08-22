/**
 * pressure-sensor — 外置压力感应提醒（v0.2）
 *
 * 监测会话的推理压力信号，在"压力状态"下注入一条温和提醒：
 *   - 单步推理过长（chars 超阈值；Flash 系按 0.6× 缩放——轻量模型推理链短）
 *   - 推理流循环模式（but wait / actually / 重新确认 / 让我再 高频重复）
 *   - 连续多步无工具调用
 *
 * 设计哲学：提醒不是压制——模型想深想就深想（深度自主），传感器只在
 * 可观测的"压力信号"出现时给一个选择："若已足够则行动；若需更深则用
 * 泄压口（MAXential）结构化思考"。提醒经 pre-step 注入（缓存中性，
 * 与近场引导同通道），防重复（每步冷却）。
 */
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'pressure-sensor'

export const inject = ['systemPrompt']

const LOG = join(process.env.DSH_HOME || homedir(), 'pressure-sensor-debug.log')
function log(msg) {
  try { appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8') } catch { /* ignore */ }
}

/** 压力阈值（可配置）。 */
const CHARS_PER_STEP = 30000 // 单步推理字符阈值
// P2: JS \b 对中文无效（中文非 \w）——中文词单独匹配
const LOOP_PATTERN = /(but wait|actually|hold on|hmm|重新确认|让我再|再想想|等一下)/gi
const LOOP_HITS = 4 // 循环词阈值
const NO_TOOL_STEPS = 3 // 连续无工具调用步数阈值
/** Flash 系模型：推理链天然更短——阈值按此比例收紧（STANDARD-PLAN §9.4 压力阈值自适）。 */
const FLASH_SCALE = 0.6

/** 每会话压力状态。 */
const state = new Map() // session id -> { stepChars, loopHits, noToolSteps, lastGuideAt }

export function apply(ctx, config = {}) {
  const charsPerStep = Number(config.charsPerStep || CHARS_PER_STEP)
  const loopHits = Number(config.loopHits || LOOP_HITS)
  const noToolSteps = Number(config.noToolSteps || NO_TOOL_STEPS)

  // 会话事件跟踪：reasoning-delta 累积 + 工具调用 = 行动信号（session/event 是唯一真实事件通道；
  // 旧实现监听 agent/assistant.chunk/tool.call 顶级事件不存在，压力感应实际从未触发）
  ctx.on('session/event', (session, event) => {
    const sid = session?.id
    if (!sid) return
    const st = state.get(sid) ?? { stepChars: 0, loopHits: 0, noToolSteps: 0, lastGuideAt: 0, stepNo: 0 }
    state.set(sid, st)
    if (event?.type === 'assistant/chunk') {
      const chunk = event.data?.chunk
      if (chunk?.type === 'reasoning-delta') {
        const t = chunk.text || ''
        st.stepChars += t.length
        st.loopHits += (t.match(LOOP_PATTERN) || []).length
      }
    } else if (event?.type === 'tool/call' || event?.type === 'tool/code-dispatch') {
      st.noToolSteps = 0
    }
  })

  // pre-step：评估压力并注入提醒（冷却 3 步——v1.5 降噪）
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const sid = agent?.session?.id
    if (!sid || !agent.inbox) return decision
    const st = state.get(sid)
    if (!st) return decision

    // 评估信号（按模型缩放：Flash 系轻量阈值）
    const model = String(agent?.options?.model || '')
    const scale = /flash/i.test(model) ? FLASH_SCALE : 1
    const triggers = []
    if (st.stepChars > charsPerStep * scale) triggers.push(`deep-reasoning ${st.stepChars} chars`)
    if (st.loopHits >= Math.max(2, Math.round(loopHits * scale))) triggers.push(`loop-pattern x${st.loopHits}`)
    st.noToolSteps += 1
    if (st.noToolSteps >= noToolSteps) triggers.push(`${st.noToolSteps} steps no action`)

    // 步推进（v1.5 冷却 2→3 步：反馈"提醒与开发任务混在一起干扰注意力"——降噪但保留捕获）
    st.stepNo += 1
    const cooled = st.stepNo - st.lastGuideAt >= 3

    if (triggers.length > 0 && cooled) {
      st.lastGuideAt = st.stepNo
      // v1.6 文案澄清（三轮实弹："loop-pattern x31 到底代表什么没说明，容易被误读成该停手了"）：
      // 提醒是自检信号不是命令——每个触发器给出含义。
      const guide =
        '\n\nPressure sensor (self-check signal, not an order): ' + triggers.join(', ') + '. '
        + 'Meaning: deep-reasoning = this step\'s thinking exceeded the character threshold; loop-pattern = repeated second-guessing words (but wait / actually / 重新确认) detected — a signal to consider the MAXential valve, NOT a command to stop; "N steps no action" = consecutive steps without a tool call — a signal to act rather than keep planning. '
        + 'Choice is ours: if reasoning has settled, act now (call the next tool — write, edit, or run the next step); '
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
