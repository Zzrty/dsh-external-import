/**
 * Per-session instructions typed by the user.
 *
 * Each agent gets one scoped system-prompt section whose text is read from the
 * management state on every assembly. Scoping the registration through
 * `agent.ctx` keeps it to that session, and the loop logs the rendered prompt as
 * a `system/message`, so the instruction is replayable without this plugin
 * emitting a session event of its own.
 *
 * @module dsh-external-import/session-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { StateStore } from './state.ts'

/** Prompt section name; a scoped section shadows a same-named global one. */
export const SESSION_PROMPT_SECTION = 'external-import:session-prompt'

/**
 * Section order. The harness identity is -1000 and the deployment persona is 0,
 * so session instructions sit directly after the persona and before policy.
 */
const SESSION_PROMPT_ORDER = 250

/**
 * Install one scoped prompt section per created agent.
 * @param ctx - the plugin context whose scope registers the listener.
 * @param store - state store holding the per-session instructions.
 */
export function installSessionPrompts(ctx: Context, store: StateStore): void {
  ctx.on('agent/created', ({ agent }) => {
    installForAgent(agent, store)
  })
}

/** Register the section on one agent's own scope. */
function installForAgent(agent: Agent, store: StateStore): void {
  agent.ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: SESSION_PROMPT_SECTION,
      order: SESSION_PROMPT_ORDER,
      // Read on every assembly, so editing the instruction applies from the
      // next step without re-registering the section.
      text: () => renderSessionPrompt(store.current().sessionPrompts[agent.id] ?? ''),
    })
  })
}

/**
 * Render the stored instruction as prompt text.
 * @param instruction - user text, possibly empty.
 * @returns the section text; empty when the session has no instruction.
 */
export function renderSessionPrompt(instruction: string): string {
  const trimmed = instruction.trim()
  if (trimmed.length === 0) return ''
  return [
    'The user attached the following instructions to this session. They apply in addition to every other instruction:',
    '',
    trimmed,
  ].join('\n')
}
