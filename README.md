# Era SDK, CLI and Brain client

The official developer packages for [Era](https://getera.io): a typed client for the whole Era API, the `era` command line, and a small drop-in memory client for AI agents.

| Package | npm | What it is |
| --- | --- | --- |
| [`packages/era-sdk`](packages/era-sdk) | [`@getera/sdk`](https://www.npmjs.com/package/@getera/sdk) | Every Era model and action as a typed client. Node 18+, Bun, Deno, edge, browser. |
| [`packages/era-cli`](packages/era-cli) | [`@getera/cli`](https://www.npmjs.com/package/@getera/cli) | `era`: sign in with your browser, read and run every action, deploy sites, Era Brain from the terminal. |
| [`packages/era-brain`](packages/era-brain) | [`@getera/brain`](https://www.npmjs.com/package/@getera/brain) | Era Brain: long-term memory for agents and apps in a few kilobytes. |

```bash
npm install @getera/sdk          # the full API
npm install @getera/brain        # memory only
npm install -g @getera/cli       # the era command
```

```ts
import { createEra } from '@getera/sdk'

const era = createEra({ apiKey: process.env.ERA_API_KEY })   // Settings → API keys
const { data } = await era.orders.list({ status: 'unfulfilled', limit: 20 })
```

```bash
era login
era orders list --status unfulfilled --limit 20
```

Each package's README has the details: authentication, every option, examples and errors. Documentation: [docs.getera.io](https://docs.getera.io/en/api) · [SDK](https://docs.getera.io/en/api/sdk) · [CLI](https://docs.getera.io/en/cli) · [Brain](https://docs.getera.io/en/brain).

## Develop

Requirements: [Bun](https://bun.sh) 1.1 or newer.

```bash
bun install
bun run build        # builds all three packages
bun run typecheck
```

`@getera/brain` bundles the HTTP client and Brain namespace from `packages/era-sdk/src`, so keep the folders side by side. The SDK's types are generated from Era's OpenAPI document: `cd packages/era-sdk && bun run scripts/generate.ts --from https://app.getera.io/api/v1/openapi.json`.

This repository is a mirror of the packages in Era's main repository, refreshed on every release; pull requests are welcome here and are carried over.

## Related

- [geteraio/era-templates](https://github.com/geteraio/era-templates): `@getera/storefront` and `@getera/templates`, for sites on Era
- [geteraio/era-brain-plugin](https://github.com/geteraio/era-brain-plugin): Era Brain for Claude Code and Codex
- [geteraio/era-research](https://github.com/geteraio/era-research): the Era Brain benchmarks and report

## License

[MIT](LICENSE) © Era. Report security issues as described in [SECURITY.md](SECURITY.md).
