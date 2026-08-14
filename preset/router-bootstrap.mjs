/**
 * router-bootstrap: task-aware reasoning-mode router with a continuous
 * react↔spec axis.
 *
 * Reads the session's first user message, classifies the task into a
 * continuous mode in [0,1] (0 = spec plan-first, 1 = react doer), and on the
 * first model request injects the matching persona and first-turn core tool
 * set. After the first durable tool/call the full preset catalog is exposed
 * and nothing is touched again; the mode derives from durable session events,
 * so resume/reload keeps it.
 *
 * The agent can read and tune its own routing through `dev_router_status` and
 * `dev_router_mode` (self-optimization loop) — mode accepts band names
 * (spec/spec-lean/balanced/react-lean/react), 0-100 numbers, or 0.0-1.0.
 *
 * Zero external imports on purpose: relative preset rows resolve bare
 * specifiers from the user home, where `@deepseek-ai/*` is not installed.
 * The router tools therefore inline a minimal schema compiler instead of
 * importing `defineTool` from `@deepseek-ai/dsh-tools`.
 */

import {
  applyPersona, bandFor, coreFor, parseMode, personaFor, sessionMode, testinessFor, clamp01,
} from './router-core.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'router-bootstrap'

/** Prompt assembly and the tools registry must exist before registering. */
export const inject = ['systemPrompt', 'tools']

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

export function apply(ctx, config) {
  const overrides = new Map() // session id -> explicit mode (number 0..1)
  const agents = new Map() // session id -> Agent (live handle, in-process only)

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    const mode = overrides.get(session.id) ?? sessionMode(session)
    const persona = personaFor(mode)

    // The persona stays constant for the whole session (mode is fixed); only
    // the tool surface changes once, after the first durable tool/call.
    const sections = applyPersona(assembled.sections, persona)

    if (session.events.some((event) => event.type === 'tool/call')) {
      return { ...assembled, sections, contexts: [] } // promoted: full catalog
    }

    const core = new Set(coreFor(mode))
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (shell === null) {
      throw new Error(`${name}: no platform shell in catalog`)
    }
    core.add(shell)

    return {
      ...assembled,
      sections,
      contexts: [],
      tools: assembled.tools.filter((tool) => core.has(tool.name)),
    }
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
      description: 'band name (spec / spec-lean / balanced / react-lean / react), a 0-100 number, a 0.0-1.0 number, or auto to clear the override',
    },
  }

  registerTool({
    name: 'dev_router_status',
    description: 'Show this session\'s reasoning-mode routing: numeric mode, band, persona, first-turn core tools, test-suppression, and whether an override is active.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const mode = overrides.get(session.id) ?? sessionMode(session)
      return [
        `mode=${mode.toFixed(2)} (band=${bandFor(mode)})`,
        `persona=${personaFor(mode).replace(/\n/g, ' / ')}`,
        `core=[${coreFor(mode).join(', ')}]`,
        `testiness=${testinessFor(mode)}`,
        `override=${overrides.has(session.id) ? 'yes' : 'no'}`,
      ].join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: 'Set this session\'s reasoning mode on the react↔spec axis: spec (0) plan-first … balanced (0.5) … react (1) doer. Accepts band names, 0-100, or 0.0-1.0; use auto to return to task classification. The next request applies it.',
    parameters: modeSpec,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args) {
      const parsed = parseMode(args.mode)
      if (parsed === null) return `invalid mode "${args.mode}": use spec/spec-lean/balanced/react-lean/react, 0-100, 0.0-1.0, or auto`
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      if (parsed === 'auto') overrides.delete(session.id)
      else overrides.set(session.id, clamp01(parsed))
      const current = overrides.get(session.id) ?? sessionMode(session)
      return `mode=${current.toFixed(2)} (band=${bandFor(current)}) — next request applies`
    },
  })

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    const last = [...agents.values()].at(-1)
    return last?.session
  }
}
