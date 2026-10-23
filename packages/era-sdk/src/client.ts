/**
 * The Era API client — runtime half. Works anywhere `fetch` exists: Node 18+,
 * Bun, Deno, edge runtimes and the browser. No dependencies.
 *
 * The typed surface (`era.orders.list()`, `era.leads.captureLead()`,
 * `era.actions.run('crm.capture_lead', …)`) is generated from Era's OpenAPI
 * document into `generated.ts`; this file only knows how to talk HTTP.
 */

export interface EraOptions {
  /** An Era API key (`era_…`, Settings → API keys). Server-side only — never ship it to a browser. */
  apiKey?: string
  /** An OAuth access token (`erat_…`), or a function returning a fresh one (the CLI's login refreshes it). */
  accessToken?: string | (() => string | Promise<string>)
  /** Defaults to `ERA_BASE_URL`, else https://app.getera.io. */
  baseUrl?: string
  /** A custom fetch (tests, proxies). */
  fetch?: typeof fetch
  /** Sent as User-Agent where the runtime allows it. */
  userAgent?: string
  /** Retries for 429 / 5xx / network errors on GET, and on writes that carry an Idempotency-Key. Default 2. */
  maxRetries?: number
}

export interface CallOptions {
  /** Makes a write safe to retry: the first result is replayed for 24 hours. */
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface ListParams {
  /** 1–200, default 50. */
  limit?: number
  /** `next_cursor` of the previous page. */
  cursor?: string
  /** A column; `-` for descending. Default `-created_at`. */
  order?: string
  /** Comma-separated columns to return. */
  fields?: string
  /** Text search over the text columns. */
  q?: string
}

export interface ListPage<T> {
  data: T[]
  next_cursor: string | null
}

export interface ActionResult<R = unknown> {
  ok: true
  result: R
  /** Events the action published — what automations and webhooks react to. */
  events: string[]
}

export interface EraErrorBody {
  code: string
  message: string
  status: number
  problems?: { field: string; message: string }[]
  request_id?: string
}

/** Every non-2xx answer. `code` is stable: `not_found`, `forbidden`, `invalid_input`, or the action's own precondition code (`slot_taken`). */
export class EraError extends Error {
  readonly status: number
  readonly code: string
  readonly problems?: { field: string; message: string }[]
  readonly requestId?: string
  constructor(body: EraErrorBody) {
    super(body.message)
    this.name = 'EraError'
    this.status = body.status
    this.code = body.code
    this.problems = body.problems
    this.requestId = body.request_id
  }
}

function env(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.[name]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class EraClient {
  readonly baseUrl: string
  private readonly options: EraOptions

  constructor(options: EraOptions = {}) {
    this.options = options
    this.baseUrl = (options.baseUrl ?? env('ERA_BASE_URL') ?? 'https://app.getera.io').replace(/\/$/, '')
    if (!options.apiKey && !options.accessToken && env('ERA_API_KEY')) this.options = { ...options, apiKey: env('ERA_API_KEY') }
    // An Era chat on the desktop (and CI that signs in with OAuth) supplies ERA_TOKEN, as the CLI reads it.
    else if (!options.apiKey && !options.accessToken && env('ERA_TOKEN')) this.options = { ...options, accessToken: env('ERA_TOKEN') }
  }

  private async authorization(): Promise<string | null> {
    const { apiKey, accessToken } = this.options
    if (accessToken) return `Bearer ${typeof accessToken === 'function' ? await accessToken() : accessToken}`
    if (apiKey) return `Bearer ${apiKey}`
    return null
  }

  /** One HTTP call to the Era API. Throws `EraError` for every non-2xx answer. */
  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown } & CallOptions = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v === undefined) continue
      url.searchParams.set(k, v === null ? 'null' : Array.isArray(v) ? v.join(',') : String(v))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    const auth = await this.authorization()
    if (auth) headers.authorization = auth
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey
    if (this.options.userAgent) headers['user-agent'] = this.options.userAgent
    const doFetch = this.options.fetch ?? fetch
    const retriable = method === 'GET' || !!init.idempotencyKey
    const max = retriable ? (this.options.maxRetries ?? 2) : 0
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal })
      } catch (e) {
        if (attempt < max) {
          await sleep(300 * 2 ** attempt)
          continue
        }
        throw new EraError({ code: 'network_error', message: e instanceof Error ? e.message : 'The request did not reach Era.', status: 0 })
      }
      if ((res.status === 429 || res.status >= 500) && attempt < max) {
        await sleep(Number(res.headers.get('retry-after')) * 1000 || 300 * 2 ** attempt)
        continue
      }
      const text = await res.text()
      const json = text ? (JSON.parse(text) as unknown) : null
      if (!res.ok) {
        const err = (json as { error?: EraErrorBody } | null)?.error
        throw new EraError(err && typeof err === 'object' ? err : { code: 'http_error', message: `HTTP ${res.status}`, status: res.status })
      }
      return json as T
    }
  }
}

/** Every page of a list, one row at a time. */
export async function* paginate<T>(fetchPage: (cursor?: string) => Promise<ListPage<T>>): AsyncGenerator<T> {
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    for (const row of page.data) yield row
    cursor = page.next_cursor ?? undefined
  } while (cursor)
}
