# @getera/sdk

**The Era API, typed.** Every model and every action of every Era module (orders, products, customers, leads, bookings, invoices, payments, inbox, sites, forms, files, workflows and the rest) as a TypeScript client generated from Era's OpenAPI document.

- **Complete.** Each resource is a property (`era.orders`, `era.leads`), each action is a method on it (`era.orders.cancelOrder(id)`), and every input and model has a type. When Era gains an action, the next SDK release has it.
- **Safe by construction.** A credential never reaches further than the person behind it can in the app, in its one workspace. That is checked on every call.
- **Runs anywhere.** No dependencies. Node 18+, Bun, Deno, edge runtimes and the browser.

[![npm](https://img.shields.io/npm/v/@getera/sdk)](https://www.npmjs.com/package/@getera/sdk) · [Docs](https://docs.getera.io/en/api/sdk) · [API reference](https://docs.getera.io/en/api) · MIT

## Install

```bash
npm install @getera/sdk
# or: bun add @getera/sdk · pnpm add @getera/sdk · yarn add @getera/sdk
```

## Authenticate

You need one of these:

| Credential | Where it comes from | Use it in |
| --- | --- | --- |
| **API key** (`era_…`) | Era → **Settings → API keys** (`/settings/api-keys`). Choose the workspace and what the key may reach. | Servers, scripts, CI. **Never ship it to a browser.** |
| **OAuth access token** | Era's OAuth server: your own app's sign-in, or `era login` from [`@getera/cli`](https://www.npmjs.com/package/@getera/cli). | Apps that act for a signed-in person. |

```ts
import { createEra } from '@getera/sdk'

const era = createEra({ apiKey: process.env.ERA_API_KEY })

// For a signed-in person: a token, or a function that returns a fresh one.
const eraFor = (getToken: () => Promise<string>) => createEra({ accessToken: getToken })
```

With no options, `createEra()` reads `ERA_API_KEY` (or `ERA_TOKEN`) and `ERA_BASE_URL` from the environment.

| Option | Default | What it does |
| --- | --- | --- |
| `apiKey` | `ERA_API_KEY` | An `era_…` key. Server-side only. |
| `accessToken` | `ERA_TOKEN` | An OAuth access token, or a function returning one. |
| `baseUrl` | `ERA_BASE_URL`, else `https://app.getera.io` | Another Era (self-hosted, local development). |
| `maxRetries` | `2` | Retries for 429, 5xx and network errors on reads, and on writes that carry an idempotency key. |
| `fetch` | global `fetch` | A custom fetch (proxies, tests). |
| `userAgent` | none | Sent where the runtime allows it. |

## Quickstart

```ts
import { createEra, EraError } from '@getera/sdk'

const era = createEra({ apiKey: process.env.ERA_API_KEY })

// Who am I, in which workspace, with which permissions?
const me = await era.me()

// Read: one page, or every row.
const { data, next_cursor } = await era.orders.list({ status: 'unfulfilled', limit: 20 })
for await (const order of era.orders.listAll({ 'created_at[gte]': '2026-10-01' })) console.log(order.number)

// Write: create a record, then run an action.
const customer = await era.customers.create({ name: 'Ada Lovelace', email: 'ada@example.com' })
const customerId = (customer.result as { id: string }).id
await era.leads.captureLead({ customerId, message: 'Wants the yearly plan' })

// Any action by its full name, typed by its input.
await era.actions.run('crm.capture_lead', { customerId })

// Errors carry a stable code.
try {
  await era.orders.cancelOrder(data[0].id, {}, { idempotencyKey: crypto.randomUUID() })
} catch (e) {
  if (e instanceof EraError) console.log(e.status, e.code, e.problems) // e.g. 409 already_canceled
  else throw e
}
```

A runnable version is in [`examples/create-lead.ts`](examples/create-lead.ts).

## What you get

### Resources

Every resource has `list`, `listAll` and `get`; `create`, `update` and `delete` where Era allows them; and one method per action, named in camelCase (`cancel_order` → `cancelOrder`). An action on one record takes its id first: `era.orders.cancelOrder(id, input?, opts?)`. An action on the collection takes only its input: `era.leads.captureLead(input, opts?)`.

**Lists** accept `limit` (1–200, default 50), `cursor` (the previous page's `next_cursor`), `order` (`-created_at` for descending), `fields` (comma-separated columns), `q` (text search), any column as a filter (`status: 'paid'`) and range filters as `column[gte|lte|gt|lt|ne|in|like]`.

**Writes** return `{ ok: true, result, events }`. `events` lists what the action published, which is what automations and webhooks react to. Pass `{ idempotencyKey }` to make a write safe to retry: the first result is replayed for 24 hours.

### Actions by name

```ts
const callable = await era.actions.list()          // what this credential may run right now, with input schemas
await era.actions.run('appointments.book', { /* typed by the action's input */ })
```

### Era Brain: long-term memory

```ts
await era.brain.add({ text: 'Ada prefers invoices in EUR, sent on the 1st.' })
const { results } = await era.brain.search('How does Ada want to be invoiced?')
await era.brain.graph('Who supplies the company Ada works at?')
await era.brain.forget(results[0].id)
```

Also `list`, `listAll`, `get`, `update`, `job`, `entities`, `entity`, `paths`, `sources` and `explain`. Scopes: `brain:read`, `brain:write`. If memory is all you need, [`@getera/brain`](https://www.npmjs.com/package/@getera/brain) is the same client in a few kilobytes.

### Connected apps

Era's integrations gateway (built-in connectors, vendors' MCP servers, Era's own channels), called as the person behind the credential:

```ts
const { data } = await era.apps.list({ q: 'notion', connected: true })
await era.apps.notion.notion_search({ query: 'Q3 plan' })
await era.apps.call('wikipedia', 'wikipedia_search', { query: 'Istanbul' })
```

An app that is not connected answers `app_not_connected`.

### Errors

Every non-2xx answer throws `EraError`:

| Field | Meaning |
| --- | --- |
| `status` | HTTP status (`0` when the request never reached Era) |
| `code` | Stable: `unauthorized`, `forbidden`, `not_found`, `invalid_input`, `rate_limited`, or the action's own precondition such as `slot_taken` |
| `message` | Human-readable |
| `problems` | Per-field validation problems, when there are any |
| `requestId` | Quote it when you contact support |

## In the browser

Use an OAuth access token, never an API key. Pages that run inside Era's canvas can use the single-script build that Era writes for them (`window.EraSDK.createEra(EraSDK.fromPage())`).

## Versioning

The SDK follows semver. Types are generated from Era's OpenAPI document; the API version the types were generated from is exported as `API_VERSION`.

## Develop

This package lives in [geteraio/era-sdk](https://github.com/geteraio/era-sdk) (mirrored from Era's main repository).

```bash
bun run build                                                  # dist/: ESM + .d.ts
bun run scripts/generate.ts --from https://app.getera.io/api/v1/openapi.json   # refresh the types
```

## Links

- Docs: [docs.getera.io/en/api/sdk](https://docs.getera.io/en/api/sdk)
- API reference: [docs.getera.io/en/api](https://docs.getera.io/en/api)
- CLI: [`@getera/cli`](https://www.npmjs.com/package/@getera/cli) · Memory only: [`@getera/brain`](https://www.npmjs.com/package/@getera/brain) · Your own site: [`@getera/storefront`](https://www.npmjs.com/package/@getera/storefront)
- Security issues: see [SECURITY.md](https://github.com/geteraio/era-sdk/blob/main/SECURITY.md)

## License

[MIT](LICENSE) © Era
