# @getera/brain

**Drop-in long-term memory for AI agents and apps.**

[![npm](https://img.shields.io/npm/v/@getera/brain)](https://www.npmjs.com/package/@getera/brain) · [Docs](https://docs.getera.io/en/brain) · [API reference](https://docs.getera.io/en/brain/reference) · MIT

Era Brain is long-term memory you can give any agent or app in a few lines: **add** what is worth remembering, **search** it back with hybrid recall, follow **relationships** between the people, companies and products it names, and **correct or forget** it — with real permissions. A key never sees more than the person behind it sees in Era.

- **Hybrid recall** — PostgreSQL full-text (Turkish and English) and local embeddings run side by side and are fused by rank; when two facts disagree, the newer one wins.
- **A graph, not just vectors** — facts are linked to the entities they name; typed paths (`works_at`, `supplies` …) answer "how is X connected to Y".
- **Permissions built in** — workspace-scoped keys, private memories, module-scoped facts and OAuth scopes `brain:read` / `brain:write`, re-checked on every call.
- **Small** — about 5 KB, no dependencies. Node 18+, Bun, Deno, edge runtimes.

## Install

```bash
npm install @getera/brain
```

## Authenticate

Sign up at [app.getera.io](https://app.getera.io/signup?start=brain) and choose **Memory for my AI** — the Brain setup gives you a key. Or create one any time in **Settings → API keys** and set *Reaches* to **Era Brain · memory**. Keep it on the server:

```bash
export ERA_API_KEY=era_...
```

`createBrain()` with no options reads `ERA_API_KEY` (or an OAuth access token in `ERA_TOKEN`) and `ERA_BASE_URL` (default `https://app.getera.io`). In an app that acts for a signed-in person, pass `accessToken` (a string or a function returning a fresh token) instead of a key.

| Option | Default | What it does |
| --- | --- | --- |
| `apiKey` | `ERA_API_KEY` | An `era_…` key. Server-side only. |
| `accessToken` | `ERA_TOKEN` | An OAuth access token with `brain:read` / `brain:write`. |
| `baseUrl` | `ERA_BASE_URL`, else `https://app.getera.io` | Another Era (self-hosted, local development). |
| `maxRetries` | `2` | Retries for 429, 5xx and network errors on reads and idempotent writes. |

## Quickstart

```ts
import { createBrain } from '@getera/brain'

const brain = createBrain({ apiKey: process.env.ERA_API_KEY })

// Remember. One sentence is stored as given; longer text is split into facts by Era.
const { memories } = await brain.add('Ada Lovelace prefers invoices in EUR, sent on the 1st.', { wait: 10 })

// Recall.
const { results } = await brain.search('How does Ada want to be invoiced?')
console.log(results[0]?.content) // "Ada Lovelace prefers invoices in EUR, sent on the 1st."

// Why was it returned?
const why = await brain.explain('How does Ada want to be invoiced?', results[0].id)
console.log(why.rank, why.keyword.terms, why.visible_because)

// Correct or forget.
await brain.update(results[0].id, { content: 'Ada Lovelace prefers invoices in GBP since October.' })
await brain.forget(results[0].id)
```

## More

```ts
// A conversation, ready-made facts or a record from your system
await brain.add({ messages: [{ role: 'user', content: 'I am vegetarian and I hate early meetings.' }] })
await brain.add({ facts: [{ statement: 'Kuzey Lojistik renews its contract on 1 March 2027.', kind: 'commitment', about: [{ name: 'Kuzey Lojistik', type: 'company' }] }] })
await brain.add({ record: { type: 'ticket', id: 'T-1042', title: 'Late delivery', fields: { customer: 'Kuzey Lojistik', status: 'open' } } })

// Only for me
await brain.add('My parking spot is B-14.', { private: true })

// How things connect
await brain.graph('Who supplies the company Ada works at?')
await brain.paths('Ada Lovelace', 'Babbage Parts')
await brain.entities({ q: 'Kuzey' })

// Everything Brain knows, page by page
for await (const m of brain.listAll({ kind: 'preference' })) console.log(m.content)
```

`add` returns a job: memories are filed by Era's ingestion worker, usually within seconds. Pass `wait` (seconds, up to 20) to get them back in the same call, or check later with `brain.job(id)`. A job is `waiting` when the worker needs an AI first — free text is split into facts by your workspace's AI, a private note is filed with its owner's own AI, and Brain asks the AI when a new fact may replace an older one — and `waiting_for` says what to connect (Settings → AI in Era).

## Errors

Every non-2xx answer throws `EraError { status, code, message, problems, requestId }`. `code` is stable: `unauthorized`, `forbidden` (a read-only key tried to write), `not_found` (absent and not-yours answer the same), `invalid_input`, `rate_limited`, or a Brain refusal such as `no_brain`.

## Also

- The full Era API (orders, customers, bookings …) with the same `brain` namespace: [`@getera/sdk`](https://www.npmjs.com/package/@getera/sdk) — `era.brain.search(…)`.
- From the terminal: [`@getera/cli`](https://www.npmjs.com/package/@getera/cli) — `era brain add "…"`, `era brain search "…"`.
- In Claude Code, Codex or Cursor over MCP: [geteraio/era-brain-plugin](https://github.com/geteraio/era-brain-plugin).
- Docs: [docs.getera.io/en/brain](https://docs.getera.io/en/brain) · API reference: [docs.getera.io/en/brain/reference](https://docs.getera.io/en/brain/reference)

A runnable example is in [`examples/remember.ts`](examples/remember.ts).

## Develop

This package lives in [geteraio/era-sdk](https://github.com/geteraio/era-sdk) next to `@getera/sdk`, whose HTTP client and Brain namespace it bundles. `bun run build` writes `dist/` (one ESM file and one self-contained `.d.ts`).

## License

[MIT](LICENSE) © Era
