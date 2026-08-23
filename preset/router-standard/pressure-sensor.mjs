/**
 * pressure-sensor — 外置压力感应提醒（v1.15 重建）
 *
 * 前情：本文件曾被宿主侧编辑删除（源/安装/ git 三方均无），导致 §3.3 声称的压力机制
 * 从未挂载（用户实测 #7"整个会话未观察到"的根因）。v1.15 按 v1.10 定稿语义重建 +
 * 可观测化：dev_router_status 显示 pressure 统计（armed/触发次数/上次时间）。
 *
 * 触发语义（v1.10 定稿，深度自主——不干预思考自由）：
 *   只在「失联」时提醒——连续 noToolSteps 步无任何工具调用；
 *   deep-reasoning / loop-pattern 只是失联期间的附加描述，绝不独立触发；
 *   冷却 3 步；Flash 系阈值按 FLASH_SCALE 收紧。
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
const NO_TOOL_STEPS = 5 // 连续无工具调用步数阈值（失联判据）
/** Flash 系模型：推理链天然更短——阈值按此比例收紧（STANDARD-PLAN §9.4 压力阈值自适）。 */
const FLASH_SCALE = 0.6

/** 每会话压力状态 + 可观测统计（v1.15：跨 preset 代共享，dev_router_status 可读）。 */
const state = new Map()
const statsKey = Symbol.for('router-standard.pressureStats')

export function apply(ctx, config = {}) {
  const charsPerStep = Number(config.charsPerStep || CHARS_PER_STEP)
  const loopHits = Number(config.loopHits || LOOP_HITS)
  const noToolSteps = Number(config.noToolSteps || NO_TOOL_STEPS)

  // 会话事件跟踪：reasoning-delta 累积 + 工具调用 = 行动信号（session/event 是唯一真实事件通道）
  ctx.on('session/event', (session, event) => {
    const sid = session?.id
    if (!sid) return
    const st = state.get(sid) ?? { stepChars: 0, loopHits: 0, noToolSteps: 0, lastGuideAt: 0, stepNo: 0, lastTool: '', sameStreak: 0 }
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
      // v1.16 无进展循环检测（#5：重复截图/反复调参有工具调用但无进展——失联语义覆盖不到）
      const nm = String(event?.data?.name || event?.data?.toolName || '').trim()
      if (nm && nm === st.lastTool) st.sameStreak += 1
      else { st.lastTool = nm; st.sameStreak = nm ? 1 : 0 }
    }
  })

  // pre-step：评估压力并注入提醒（冷却 3 步；失联触发）
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const sid = agent?.session?.id
    if (!sid || !agent.inbox) return decision
    const st = state.get(sid)
    if (!st) return decision

    // 统计可见化（v1.15 建议 #6：是否挂载/是否触发不再靠猜）
    const stats = globalThis[statsKey] ?? (globalThis[statsKey] = {})
    stats[sid] = stats[sid] ?? { armed: false, triggered: 0, lastAt: 0 }
    stats[sid].armed = true

    // 评估信号：只判"失联"
    const model = String(agent?.options?.model || '')
    const scale = /flash/i.test(model) ? FLASH_SCALE : 1
    const triggers = []
    st.noToolSteps += 1
    if (st.noToolSteps >= noToolSteps) {
      triggers.push(`${st.noToolSteps} steps no action`)
      if (st.stepChars > charsPerStep * scale) triggers.push(`deep-reasoning ${st.stepChars} chars`)
      if (st.loopHits >= Math.max(2, Math.round(loopHits * scale))) triggers.push(`loop-pattern x${st.loopHits}`)
    }
    // v1.16 无进展循环：同一工具连续 ≥4 次调用（有行动但没进展——重复截图/反复调参）
    if (st.sameStreak >= 4 && st.lastTool) triggers.push(`same tool x${st.sameStreak} in a row (${st.lastTool}) — no-progress loop detected`)

    st.stepNo += 1
    const cooled = st.stepNo - st.lastGuideAt >= 3

    if (triggers.length > 0 && cooled) {
      st.lastGuideAt = st.stepNo
      stats[sid].triggered += 1
      stats[sid].lastAt = Date.now()
      const guide =
        '\n\nPressure sensor (self-check signal, not an order): ' + triggers.join(', ') + '. '
        + 'Meaning: deep-reasoning = this step\'s thinking exceeded the character threshold; loop-pattern = repeated second-guessing words detected — a signal to consider the MAXential valve, NOT a command to stop; "N steps no action" = consecutive steps without a tool call — a signal to act rather than keep planning. '
        + 'Choice is ours: if reasoning has settled, act now; if deeper thinking is needed, use the pressure valve (MAXential) — think a step, revise, branch + merge, complete when truly settled. Depth is our call.'
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

    st.stepChars = 0
    st.loopHits = 0
    return decision
  })
}

/** 可观测统计读取（dev_router_status 用；无记录返回 'not mounted / no observation yet'）。 */
export function pressureStatsFor(sid) {
  const stats = globalThis[statsKey] || {}
  const s = stats[sid]
  if (!s) return 'mounted, 0 triggers observed (失联未发生——v1.10 语义：只在连续无工具调用时提醒)'
  return `mounted, armed=${s.armed}, triggered=${s.triggered}` + (s.lastAt ? `, last=${new Date(s.lastAt).toISOString()}` : '')
}
