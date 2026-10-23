/**
 * Era Brain — the memory half of the SDK (`era.brain.*`), also published on its
 * own as `@getera/brain` for apps and agents that only want memory.
 *
 *   const era = createEra({ apiKey: process.env.ERA_API_KEY })
 *   await era.brain.add({ text: 'Ada prefers invoices in EUR, sent on the 1st.' })
 *   const { results } = await era.brain.search('How does Ada want to be invoiced?')
 *
 * Every method maps to one endpoint of `/api/v1/brain` (OpenAPI tag `brain`;
 * the list lives in Era's kernel and `bun run check` fails if this file misses
 * one). Scopes: `brain:read` for reading, `brain:write` to add, correct and
 * forget. A credential never sees more than the person behind it sees in the
 * Era app: their workspace, modules they can read, nobody else's private facts.
 */

import type { CallOptions, EraClient } from './client'

export type BrainVisibility = 'workspace' | 'private' | 'module'
export type BrainFactKind = 'fact' | 'preference' | 'decision' | 'commitment' | 'episode'
export type BrainSourceKind = 'note' | 'conversation' | 'record' | 'file' | 'web' | 'meeting' | 'call'
export type BrainEntityType = 'person' | 'customer' | 'company' | 'product' | 'project' | 'topic'

export interface BrainEntityRef {
  id: string
  name: string
  type: string
}

export interface BrainMemory {
  id: string
  content: string
  kind: string
  importance: number | null
  confidence: number | null
  /** workspace: every member who can read Brain · private: only the person who saved it · module: only readers of `module`. */
  visibility: BrainVisibility
  module: string | null
  source: { kind: string | null; ref: string | null; label: string | null; url: string | null; at: string | null }
  entities: BrainEntityRef[]
  excerpt: string | null
  valid_from: string | null
  created_at: string
}

export interface BrainRecall {
  id: string
  content: string
  kind: string
  /** Fused rank score — higher is better, comparable within one answer only. */
  score: number
  importance: number
  source_type: string | null
  excerpt: string | null
  created_at: string
  /** A newer fact about the same thing ranks above this one (latest value wins). */
  earlier?: true
}

export interface BrainHop {
  from: string
  relation: string
  to: string
  /** The memory that states this hop. */
  evidence: string | null
  memory_id?: string | null
}

export interface BrainPath {
  score: number
  kind?: 'typed' | 'co' | 'mention'
  hops: BrainHop[]
}

export interface BrainJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'waiting' | string
  error: string | null
  /** With status `waiting`: what the worker needs first (a private note is filed with its owner's own AI; free text needs a model). */
  waiting_for?: string
  /** Facts waiting for a person to approve them on the Brain screen (a brain that asks first about conversations). */
  pending_approval?: number
  created_at?: string
  finished_at?: string | null
}

export interface BrainFactInput {
  /** One self-contained sentence. */
  statement: string
  kind?: BrainFactKind
  about?: { name: string; type: BrainEntityType }[]
  confidence?: number
  importance?: number
  occurred_at?: string
  expires_at?: string
}

export interface BrainSourceInput {
  kind?: BrainSourceKind
  /** Your own id for it. Adding a record again with the same ref replaces what it said before. */
  ref?: string
  label?: string
  url?: string
  at?: string
}

/** Exactly one of text, messages, facts or record. */
export type BrainAddInput = (
  | { text: string; messages?: never; facts?: never; record?: never }
  | { messages: { role: 'user' | 'assistant' | 'system'; content: string; name?: string }[]; text?: never; facts?: never; record?: never }
  | { facts: BrainFactInput[]; text?: never; messages?: never; record?: never }
  | { record: { type: string; id?: string; title?: string; fields: Record<string, unknown> }; text?: never; messages?: never; facts?: never }
) & {
  source?: BrainSourceInput
  /** private: only you will ever recall it. Default workspace. */
  visibility?: 'workspace' | 'private'
  /** Keep it to the readers of one module you can read (e.g. `crm`). */
  module?: string
  /** Seconds (0–20) to wait for the memories to be stored. Default 0. */
  wait?: number
}

export interface BrainExplanation {
  memory: BrainMemory
  returned: boolean
  rank: number | null
  score: number | null
  keyword: { matched: boolean; terms: string[] }
  semantic: { similarity: number | null }
  shared_entities: BrainEntityRef[]
  recency_days: number
  importance: number
  superseded: boolean
  visible_because: string
  note?: string
}

export interface BrainApi {
  /** Remember text, a conversation, ready-made facts or a record. */
  add(input: BrainAddInput, opts?: CallOptions): Promise<{ job: BrainJob; memories?: BrainMemory[] }>
  /** Hybrid recall (keyword + semantic, latest value wins). `graph: true` adds typed relationship paths. */
  search(query: string, opts?: { limit?: number; graph?: boolean }): Promise<{ query: string; used_vector: boolean; results: BrainRecall[]; paths?: BrainPath[]; context?: string }>
  /** What Brain knows now, newest first. */
  list(params?: { q?: string; kind?: BrainFactKind; entity_id?: string; source?: string; limit?: number; cursor?: string }): Promise<{ data: BrainMemory[]; next_cursor: string | null }>
  /** Every memory, page by page. */
  listAll(params?: { q?: string; kind?: BrainFactKind; entity_id?: string; source?: string }): AsyncGenerator<BrainMemory>
  get(id: string): Promise<BrainMemory & { history: { id: string; content: string; valid_to: string | null }[] }>
  /** Correct the wording, confirm, keep private or recategorise. */
  update(id: string, change: { content?: string; confirm?: boolean; visibility?: 'private'; category?: 'preference' | 'rule' | 'procedure' | 'fact' }): Promise<{ ok: true; id: string }>
  /** Era stops using it at once. */
  forget(id: string): Promise<{ ok: true; id: string }>
  /** The status of an add, and what it stored once done. */
  job(id: string): Promise<{ job: BrainJob; memories: BrainMemory[] }>
  entities(params?: { q?: string; type?: string; limit?: number }): Promise<{ data: (BrainEntityRef & { aliases: string[]; facts: number })[] }>
  entity(id: string): Promise<BrainEntityRef & { aliases: string[]; relations: { direction: 'out' | 'in'; relation: string; entity: BrainEntityRef }[]; facts: BrainRecall[] }>
  /** Typed relationship paths for a question — the read path Era's own chat uses. */
  graph(query: string, opts?: { limit?: number }): Promise<{ query: string; anchors: BrainEntityRef[]; paths: BrainPath[]; context: string }>
  /** The shortest chain of relations between two named entities. */
  paths(from: string, to: string, opts?: { maxDepth?: number }): Promise<{ found: boolean; from: BrainEntityRef | null; to: BrainEntityRef | null; hops: BrainHop[] }>
  sources(): Promise<{ connected: { id: string; provider: string; label: string | null; status: string; items_synced: number; last_synced_at: string | null }[]; kinds: { kind: string; memories: number; last_at: string | null }[] }>
  /** Why a fact was (or was not) returned for a question. */
  explain(query: string, memoryId: string): Promise<BrainExplanation>
}

/** OpenAPI operationId (brain_<id>) → the method above. `bun run check` keeps the two in step. */
export const BRAIN_OPERATIONS = {
  brain_add: 'add',
  brain_search: 'search',
  brain_search_get: 'search',
  brain_list: 'list',
  brain_get: 'get',
  brain_update: 'update',
  brain_forget: 'forget',
  brain_job: 'job',
  brain_entities: 'entities',
  brain_entity: 'entity',
  brain_graph: 'graph',
  brain_paths: 'paths',
  brain_sources: 'sources',
  brain_explain: 'explain',
} as const satisfies Record<string, keyof BrainApi>

const enc = encodeURIComponent

export function brainApi(client: EraClient): BrainApi {
  const base = '/api/v1/brain'
  const api: BrainApi = {
    add: (input, opts) => client.request('POST', `${base}/memories`, { body: input, ...opts }),
    search: (query, opts = {}) => client.request('POST', `${base}/search`, { body: { query, ...opts } }),
    list: (params = {}) => client.request('GET', `${base}/memories`, { query: params }),
    async *listAll(params = {}) {
      let cursor: string | undefined
      do {
        const page = await api.list({ ...params, cursor })
        for (const m of page.data) yield m
        cursor = page.next_cursor ?? undefined
      } while (cursor)
    },
    get: async (id) => (await client.request<{ data: Awaited<ReturnType<BrainApi['get']>> }>('GET', `${base}/memories/${enc(id)}`)).data,
    update: (id, change) => client.request('PATCH', `${base}/memories/${enc(id)}`, { body: change }),
    forget: (id) => client.request('DELETE', `${base}/memories/${enc(id)}`),
    job: (id) => client.request('GET', `${base}/jobs/${enc(id)}`),
    entities: (params = {}) => client.request('GET', `${base}/entities`, { query: params }),
    entity: async (id) => (await client.request<{ data: Awaited<ReturnType<BrainApi['entity']>> }>('GET', `${base}/entities/${enc(id)}`)).data,
    graph: (query, opts = {}) => client.request('GET', `${base}/graph`, { query: { q: query, limit: opts.limit } }),
    paths: (from, to, opts = {}) => client.request('GET', `${base}/paths`, { query: { from, to, max_depth: opts.maxDepth } }),
    sources: () => client.request('GET', `${base}/sources`),
    explain: (query, memoryId) => client.request('POST', `${base}/explain`, { body: { query, memory_id: memoryId } }),
  }
  return api
}
