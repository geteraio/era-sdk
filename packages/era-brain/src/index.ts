/**
 * @getera/brain — drop-in long-term memory for AI agents and apps, from Era.
 *
 *   import { createBrain } from '@getera/brain'
 *   const brain = createBrain({ apiKey: process.env.ERA_API_KEY })
 *
 *   await brain.add('Ada Lovelace prefers invoices in EUR, sent on the 1st.')
 *   const { results } = await brain.search('How does Ada want to be invoiced?')
 *   await brain.forget(results[0].id)
 *
 * The same client as `era.brain` in `@getera/sdk`, without the business modules
 * (a few KB, no dependencies). Works in Node 18+, Bun, Deno and edge runtimes.
 * Keys come from Settings → API keys (choose "Era Brain · memory"); `era login`
 * tokens work too. A key never sees more than the person behind it sees in Era.
 */

import { EraClient, EraError, type EraOptions } from '../../era-sdk/src/client'
import { brainApi, type BrainAddInput, type BrainApi } from '../../era-sdk/src/brain'

export { EraError }
export type { EraOptions }
export type * from '../../era-sdk/src/brain'

export type Brain = Omit<BrainApi, 'add'> & {
  /** Remember a sentence or a note (a string), or text / messages / facts / a record. */
  add(input: string | BrainAddInput, opts?: { wait?: number; private?: boolean; idempotencyKey?: string }): ReturnType<BrainApi['add']>
  client: EraClient
}

export function createBrain(options: EraOptions = {}): Brain {
  const client = new EraClient({ userAgent: 'getera-brain', ...options })
  const api = brainApi(client)
  return {
    ...api,
    client,
    add(input, opts = {}) {
      let body: BrainAddInput
      if (typeof input === 'string') {
        const text = input.trim()
        // One sentence (≤ 500 characters, one line) is stored as given; a longer text is extracted
        // into facts by your workspace's AI.
        body = text.length <= 500 && !text.includes('\n') ? { facts: [{ statement: text }] } : { text }
      } else body = input
      if (opts.wait !== undefined) body = { ...body, wait: opts.wait }
      if (opts.private) body = { ...body, visibility: 'private' }
      return api.add(body, opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined)
    },
  }
}

export default createBrain
