/**
 * @getera/sdk — Era's typed API client.
 *
 *   import { createEra } from '@getera/sdk'
 *   const era = createEra({ apiKey: process.env.ERA_API_KEY })
 *
 *   const { data } = await era.orders.list({ status: 'unfulfilled', limit: 20 })
 *   await era.orders.cancelOrder(data[0].id)
 *   await era.leads.captureLead({ name: 'Ada Lovelace', email: 'ada@example.com' })
 *   await era.actions.run('crm.capture_lead', { name: 'Ada' })
 *
 *   await era.brain.add({ text: 'Ada prefers invoices in EUR, sent on the 1st.' })
 *   const { results } = await era.brain.search('How does Ada want to be invoiced?')
 *
 *   await era.apps.call('wikipedia', 'wikipedia_search', { query: 'Istanbul' })
 *   await era.apps.notion.notion_search({ query: 'Q3 plan' })
 *
 * Every model and action comes from Era's module manifests through the OpenAPI
 * document (generated.ts); a credential never reaches further than the person
 * behind it can in the app.
 */

import { EraClient, paginate, type ActionResult, type CallOptions, type EraOptions, type ListPage } from './client'
import { brainApi, type BrainApi } from './brain'
import { appsApi, type Apps } from './apps'
import { RESOURCES, type ActionInputs, type ActionName, type EraResources } from './generated'

export * from './client'
export * from './generated'
export * from './brain'
export * from './apps'

export interface Me {
  user: { id: string; name: string }
  workspace: { id: string; organization_id: string }
  credential: { kind: 'key' | 'oauth' | 'session'; id: string; client_id: string | null; scopes: string[] }
  /** Module → the capabilities this credential has right now. */
  modules: Record<string, string[]>
}

export interface CallableAction {
  name: ActionName
  module: string
  moduleLabel: string
  label: string
  summary: string
  requires: string
  risk?: string
  path: string
  resourcePath?: string
  idField?: string
  preconditions: { code: string; describe: string }[]
  input: Record<string, unknown>
}

export type Era = EraResources & {
  client: EraClient
  /** The person, workspace and permissions behind this credential. */
  me(): Promise<Me>
  actions: {
    /** Run any action by name, typed by its input. */
    run<N extends ActionName>(name: N, input: ActionInputs[N], opts?: CallOptions): Promise<ActionResult>
    /** The actions this credential may call right now, with their input schemas. */
    list(): Promise<CallableAction[]>
  }
  /**
   * Era Brain — long-term memory: add, search, graph, correct, forget (scopes brain:read / brain:write).
   * Also published alone as `@getera/brain`.
   */
  brain: BrainApi
  /**
   * Connected apps (integrations gateway): `era.apps.list()`, `era.apps.call(app, tool, args)`,
   * or one tool by name — `era.apps.notion.notion_search({ query })`.
   */
  apps: Apps
  /** Brain recall (older shape; prefer `brain.search`). */
  memory: { recall(query: string, opts?: { limit?: number }): Promise<{ results: { id: string; content: string; score?: number }[] }> }
}

const camel = (s: string) => s.replace(/[_.-](\w)/g, (_, c: string) => c.toUpperCase())

export function createEra(options: EraOptions = {}): Era {
  const client = new EraClient(options)
  const era: Record<string, unknown> = {
    client,
    me: () => client.request<Me>('GET', '/api/v1/me'),
    actions: {
      run: (name: string, input: unknown, opts?: CallOptions) => client.request<ActionResult>('POST', `/api/v1/actions/${name}`, { body: input ?? {}, ...opts }),
      list: async () => (await client.request<{ data: CallableAction[] }>('GET', '/api/v1/actions')).data,
    },
    brain: brainApi(client),
    apps: appsApi(client),
    memory: {
      recall: (query: string, opts: { limit?: number } = {}) => client.request('GET', '/api/v1/memory', { query: { q: query, limit: opts.limit } }),
    },
  }
  for (const [name, def] of Object.entries(RESOURCES)) {
    const base = `/api/v1/${name}`
    const r: Record<string, unknown> = {
      list: (params: Record<string, unknown> = {}, opts?: CallOptions) => client.request<ListPage<unknown>>('GET', base, { query: params, ...opts }),
      listAll: (params: Record<string, unknown> = {}) => paginate((cursor) => client.request<ListPage<unknown>>('GET', base, { query: { ...params, cursor } })),
      get: async (id: string, opts?: CallOptions) => (await client.request<{ data: unknown }>('GET', `${base}/${encodeURIComponent(id)}`, opts)).data,
    }
    if (def.c) r.create = (input: unknown, opts?: CallOptions) => client.request<ActionResult>('POST', base, { body: input ?? {}, ...opts })
    if (def.u) r.update = (id: string, input: unknown, opts?: CallOptions) => client.request<ActionResult>('PATCH', `${base}/${encodeURIComponent(id)}`, { body: input ?? {}, ...opts })
    if (def.d) r.delete = (id: string, opts?: CallOptions) => client.request<ActionResult>('DELETE', `${base}/${encodeURIComponent(id)}`, opts)
    for (const [fn, [verb, kind]] of Object.entries(def.a)) {
      r[fn] =
        kind === 'i'
          ? (id: string, input: unknown = {}, opts?: CallOptions) => client.request<ActionResult>('POST', `${base}/${encodeURIComponent(id)}/actions/${verb}`, { body: input, ...opts })
          : (input: unknown = {}, opts?: CallOptions) => client.request<ActionResult>('POST', `${base}/actions/${verb}`, { body: input, ...opts })
    }
    era[camel(name)] = r
  }
  return era as unknown as Era
}

export default createEra
