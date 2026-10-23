# @getera/cli

**Era from your terminal.** `era` signs in with your browser and gives you every model and every action of every Era module, plus sites (`era init`, `era deploy`), memory (`era brain`) and connected apps. It talks to the public Era API as you, with exactly the permissions you have in the app.

[![npm](https://img.shields.io/npm/v/@getera/cli)](https://www.npmjs.com/package/@getera/cli) · [Docs](https://docs.getera.io/en/cli) · [Command reference](https://docs.getera.io/en/cli/commands) · MIT

## Install

```bash
npm install -g @getera/cli      # or: bun add -g @getera/cli
era --version
era --help
```

Or run it without installing: `npx @getera/cli --help`.

Node 20 or newer runs everything except the site template commands (`era init`, `era dev`, `era build` with a template), which need [Bun](https://bun.sh).

## Sign in

```bash
era login
```

`era login` prints an address and a short code and opens your browser. Check the code, then on Era's consent card choose **the workspace**, **which modules** the terminal may use, and whether it may only **read**. The terminal gets exactly that.

```text
  Signed in as Ada Lovelace — workspace 7f1c… — 14 modules.
```

| Flag | What it does |
| --- | --- |
| `--no-browser` | Only print the address (SSH sessions, servers). Open it on any device. |
| `--scope "crm retail:read"` | Ask for less, e.g. sales in full and the shop read-only. |
| `--base-url <url>` | Sign in to another Era (self-hosted, development). |
| `--profile work` | Keep several sign-ins side by side; pass `--profile` to any command. |

The sign-in lives in one file only you can read: `%APPDATA%\era\credentials.json` on Windows, `~/.config/era/credentials.json` elsewhere (`ERA_CONFIG_DIR` moves it). It renews itself. `era logout` signs out and revokes the token. `era whoami` shows who, which workspace and what you may do.

**CI and scripts:** skip `era login` and set `ERA_API_KEY` (an `era_…` key from **Settings → API keys**) or `ERA_TOKEN` (an OAuth access token). `ERA_BASE_URL` points at another Era. The environment wins over the saved sign-in.

## Examples

### Your data

```bash
era resources                                   # what you can read here
era orders list --status unfulfilled --limit 20
era orders list --where "total[gte]=100" --all --json
era customers get <id>
era customers create --name "Ada Lovelace" --email ada@example.com
era orders cancel_order <id>                    # an action on one record
era crm capture_lead --customer-id <id> --message "Wants the yearly plan"
era actions crm                                 # every action you may run in a module, with its fields
era run crm.capture_lead --data @lead.json      # any action by its full name
era api GET /api/v1/me                          # any API call
```

Input: flags (`--field value`, kebab-case or snake_case), `--data '{…}'`, `--data @file.json` or `--data -` for stdin. Every command takes `--json`.

### Messages

```bash
era channels                                    # which channels are connected
era email send --to ada@example.com --subject "Your order" --text "It ships today."
era whatsapp send --customer <id> --text "…"    # also: era sms send …
```

A channel that is not connected fails clearly ("WhatsApp is not connected — connect it in Settings → Integrations") and sends nothing.

### Sites

```bash
era templates                                   # the 31 site templates
era init my-shop --template store               # or blog, services, or a template name
cd my-shop && era dev                           # live preview at http://localhost:4321
era deploy                                      # build and publish to <slug>.getera.site
era domains add shop.example.com
```

A folder with an `index.html` and no `template.ts` is deployed as it is: your own code, with [`@getera/storefront`](https://www.npmjs.com/package/@getera/storefront) for the catalogue, cart and checkout. Template commands use [`@getera/templates`](https://www.npmjs.com/package/@getera/templates) (`bun add -d @getera/templates`). `era theme check|import|pull` manages what the site owner can edit in Era's theme editor.

### Era Brain (memory)

```bash
era brain add "Ada prefers invoices in EUR, sent on the 1st"
era brain search "How does Ada want to be invoiced?"
era brain graph "Who supplies the company Ada works at?"
era brain forget <id>
era brain setup claude --apply                  # give Claude Code a memory (also: codex)
era brain help                                  # everything else
```

### Connected apps and AI assistants

```bash
era apps list notion --connected
era apps tools notion
era apps call notion notion_search --data '{"query":"Q3 plan"}'
era mcp --client claude                         # how to connect Claude Code, Codex or Cursor over MCP
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Invalid arguments or input |
| 3 | Not signed in, or the session expired |
| 4 | Refused: permission, approval, not found, or an action's precondition |
| 5 | Failed or partial operation |
| 6 | Connection or protocol failure |
| 7 | Timeout |

## Inside an Era chat

When an Era chat runs Claude Code or Codex on your desktop, the session's terminal already has `era` on its PATH. There, `era <noun> <verb>` (records, message, document, meeting, file, brain, approvals …) goes through the chat's own thread-scoped door, so the server keeps permissions, approvals and the ledger. `era tools` lists what that session may call. The public commands above work there too. No credentials are written to files.

## Develop

This package lives in [geteraio/era-sdk](https://github.com/geteraio/era-sdk) (mirrored from Era's main repository).

```bash
bun run build              # dist/era.mjs, one file, no dependencies
bun run dev -- --help      # run from source
node --test src/arguments.test.ts
```

## Links

- Docs: [docs.getera.io/en/cli](https://docs.getera.io/en/cli) · [Install and sign in](https://docs.getera.io/en/cli/install-and-login) · [Commands](https://docs.getera.io/en/cli/commands)
- SDK: [`@getera/sdk`](https://www.npmjs.com/package/@getera/sdk) · Memory: [`@getera/brain`](https://www.npmjs.com/package/@getera/brain) · Brain plugin for Claude Code: [geteraio/era-brain-plugin](https://github.com/geteraio/era-brain-plugin)
- Security issues: see [SECURITY.md](https://github.com/geteraio/era-sdk/blob/main/SECURITY.md)

## License

[MIT](LICENSE) © Era
