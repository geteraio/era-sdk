/**
 * Connected apps — `era.apps.*`: every app in Era's integrations gateway
 * (native connectors, remote MCP servers and Era's own channels), called the
 * same way.
 *
 *   const era = createEra({ apiKey: process.env.ERA_API_KEY })
 *   const { data } = await era.apps.list({ q: 'notion' })
 *   const tools = await era.apps.tools('notion')
 *   await era.apps.notion.notion_search({ query: 'Q3 plan' })          // one tool, by name
 *   await era.apps.call('wikipedia', 'wikipedia_search', { query: 'Istanbul' })
 *
 * A call runs as the person behind the credential: the app's connection must
 * be theirs, shared with them, or the company's, and their role must cover
 * the app's Era module (read for a read-only tool, write otherwise). An app
 * that is not connected answers `app_not_connected` — never another app.
 */

import type { CallOptions, EraClient } from './client'

export interface EraApp {
  id: string
  name: string
  description: string
  category: string
  /** The Era module whose data the app stands for (null = general, needs Apps access). */
  module: string | null
  /** How Era reaches it: native connector, remote MCP server, Era channel — or several. */
  kinds: ('connector' | 'mcp' | 'native')[]
  /** How it connects: oauth, api_key, multi_field, none… */
  auth: string
  toolCount: number | null
  triggerCount: number
  connected: boolean
}

export interface EraAppTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  readOnly: boolean
}

export interface EraAppTrigger {
  id: string
  name: string
  description: string
  kind: 'webhook' | 'polling'
}

export interface EraToolResult {
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
}

export interface AppCallOptions extends CallOptions {
  /** Which account: `auto` (default), `mine`, `workspace`, or a connection id. */
  connection?: string
}

export interface AppsApi {
  /** The catalogue, with what this person has connected and the coverage counters. */
  list(params?: { q?: string; category?: string; connected?: boolean }, opts?: CallOptions): Promise<{ data: EraApp[]; coverage: Record<string, number> }>
  /** One app with its tools and triggers. */
  get(appId: string, opts?: CallOptions): Promise<EraApp & { tools: EraAppTool[]; triggers: EraAppTrigger[] }>
  /** The tools this person may see for an app. */
  tools(appId: string, opts?: AppCallOptions): Promise<EraAppTool[]>
  /** Run one tool. */
  call(appId: string, tool: string, args?: Record<string, unknown>, opts?: AppCallOptions): Promise<EraToolResult>
}

/** `era.apps.<app>.<tool>(args)` — one function per tool, by its name. */
export type AppHandle = Record<string, (args?: Record<string, unknown>, opts?: AppCallOptions) => Promise<EraToolResult>>

export type Apps = AppsApi & Record<string, AppHandle>

export function appsApi(client: EraClient): Apps {
  const enc = encodeURIComponent
  const api: AppsApi = {
    list: (params = {}, opts) =>
      client.request('GET', '/api/v1/apps', { query: { q: params.q, category: params.category, connected: params.connected }, ...opts }),
    get: async (appId, opts) => (await client.request<{ data: EraApp & { tools: EraAppTool[]; triggers: EraAppTrigger[] } }>('GET', `/api/v1/apps/${enc(appId)}`, opts)).data,
    tools: async (appId, opts = {}) =>
      (await client.request<{ data: EraAppTool[] }>('GET', `/api/v1/apps/${enc(appId)}/tools`, { query: { connection: opts.connection }, ...opts })).data,
    call: async (appId, tool, args = {}, opts = {}) =>
      (await client.request<{ data: EraToolResult }>('POST', `/api/v1/apps/${enc(appId)}/tools/${enc(tool)}`, { body: { arguments: args, connection: opts.connection }, ...opts })).data,
  }
  return new Proxy(api as Apps, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target || prop === 'then') return (target as Record<string, unknown>)[prop as string]
      const appId = prop
      return new Proxy({} as AppHandle, {
        get(_t, tool) {
          if (typeof tool !== 'string' || tool === 'then') return undefined
          return (args?: Record<string, unknown>, opts?: AppCallOptions) => api.call(appId, tool, args ?? {}, opts)
        },
      })
    },
  })
}
