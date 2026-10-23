/** Written beside Era's other native skills for Claude Code and Codex. */
export const ERA_CLI_SKILL = {
  slug: "era-cli",
  description: "Use the era terminal command for Era business records, files, knowledge, screens and approved actions in an Era chat, and for building on Era: the API (era orders list, era actions), site templates, build and deploy (era templates|init|build|deploy).",
  body: `# Era from the terminal

Use \`era\` for this person's Era business data and actions. Your own terminal, file, web, creative tools and subagents remain available. MCP is also available; choose one door for an operation and never submit the same write through both.

Run \`era --help\` for syntax. \`era tools\` returns the live, permission-filtered tool schemas; do not assume fields from an old example. Results are compact JSON; \`--text\` formats them for reading. Flags match server fields (\`--customer-id\` becomes \`customerId\`). Keep IDs as strings.

Choose the command:
- A bare --text selects human output. Supply a tool's text field through JSON or --text="message".
- \`overview\`: enabled modules, apps, computers, approvals, work, today's numbers.
- \`records find|create|update|archive\`: business records. Give the type as the next word. Find supports q, id, mode, where, table, module, limit and next. There is no row cap: repeat with \`--next <next>\` until next is null (a cut page's next continues right after its last row). Types also cover channel_order, integration, approval (ids for approvals decide), agent, table (the Tables list) and module_row (\`--module <code> --table <name>\`, \`--mode columns\` first).
- \`message send\`, \`document create|issue\`, \`meeting schedule\`: messages, invoice/quote drafts and calendar entries.
- \`numbers\` and \`free-times\`: metrics and bookable slots.
- \`site edit|publish\`: draft changes, then publication when requested.
- \`file save --export '{"type":"lead"}'\` exports every row of a source (all pages, on the server) as a spreadsheet and returns the row count; use it instead of paging when the person wants the whole list as a file.
- \`file save|get|import\`: share outputs across devices, obtain a download link/command, import a spreadsheet. A relative local path is resolved in your terminal folder. Import uses target crm|table|dashboard; a local path is saved first. For a large file, file save returns a one-time upload command: run it before importing its returned fileId. File get returns a short-lived download command; execute it with your own terminal to materialize the file.
- \`open\`: show record|list|file|site|approvals|page next to the chat.
- \`memory save|forget\`, \`brain search\`, \`skill save\`: durable facts, business knowledge, proposed reusable procedures. \`brain graph "Ayşe"\` shows how people, companies, products and offers connect; \`brain graph --json '{"from":"A","to":"B"}'\` the relationship path between two.
- \`approvals decide\`: only decisions the person explicitly made in words. Never approve your own request.
- \`work status\`: earlier/background work. \`turn report\`: the real write ledger, before your final answer after several writes.
- \`run\`: an exact long-tail action from the sibling era-actions skill and its reference files. The server supplies error/fix/schema for a wrong input.
- \`find "…"\`: one search over every action you may run (with its input), workflow templates, blueprints, themes and apps; \`find --name catalog.save_variant\` gives one action's whole input, then \`run\`. Use it before saying Era cannot do something.
- \`apps find\`, \`app connect instagram\` (a Bağla card in the chat; keys are never typed in the chat), \`app run --app gmail --action … --input '{…}'\`, \`media make "…" --kind image\` (the business's own fal.ai / Replicate / ElevenLabs keys).
- \`brain path --from A --to B\`, \`brain history\`, \`decision trace\`, \`decision influence\`, \`reason --facts '[…]' --rules '[…]'\`, \`ontology check\`, \`chats search "…"\`: the brain's deeper answers. \`call <tool> --json '{…}'\` reaches any tool \`tools\` lists.
- \`places search\`, \`visuals make\`, \`pc act\`: research/creative/remote-PC tools when the live catalogue permits them. Codex uses its own image generation and file save.

Building on Era (the public CLI, the same \`era\` command; it acts as this person through the session's ERA_BASE_URL + ERA_TOKEN):
- \`whoami\`, \`resources\`, \`actions [<module>]\`, \`<resource> list|get|create|update|delete\` (\`era orders list --json\`, \`era products get <id>\`), \`api GET /api/v1/…\`: the Era API with every model and action this person may use.
- \`deploy <dir> --site <id>\`, \`theme check|import|pull <dir>\`, \`domains add|list\`: a site you write yourself (Era is its backend; era.theme.json declares what the owner edits in Era), published to \`<slug>.getera.site\`. \`templates\`, \`init --template\`, \`build\`, \`dev\`: Era's 31 templates, only when the person asks for one. The era-site-builder skill has the whole flow.
- \`@getera/sdk\` in code: \`createEra()\` reads ERA_BASE_URL + ERA_TOKEN in this terminal; an app page uses \`.era/lib/era-sdk.js\` and runs in the canvas as this person (era-app-builder skill). Setting up a whole business: era-business-setup skill.
- \`era <word> --help\` on any of these words prints the public CLI's full help.

JSON input is safest across shells. Put an object or a batch array in a file; pass \`--json @file.json\`, or pipe it with \`--json -\`. Literal JSON works when correctly quoted by the current shell. An array becomes items for create/update/decide/run and ids for archive. Do not specify a field twice through flags and JSON.

On Windows PowerShell, prefer a UTF-8 file with \`--json @file.json\` for names and notes. Windows PowerShell's default native-command pipeline encoding can replace Turkish/non-ASCII letters with question marks before Era receives them. Write the file with \`[IO.File]::WriteAllText(path, json, [Text.UTF8Encoding]::new($false))\`. If stdin is necessary, first set \`$OutputEncoding = [Text.UTF8Encoding]::new($false)\`. Verify the stored names after the write; do not silently accept changed letters.

Examples:

\`\`\`sh
era records find customer --q "Ayşe" --limit 5
era records create customer --json @customers.json
era records update lead --json @changes.json
era run workflows.draft --json @workflow.json
era file save "outputs/rapor.pdf"
era file import "imports/musteriler.xlsx" --target crm
era open record --type customer --id "<returned-id>"
era turn report
\`\`\`

customers.json can be \`[{"name":"Ayşe","email":"ayse@example.test"}]\`. Changes are \`[{"id":"<returned-id>","set":{"name":"New name"}}]\`. There is no batch-size cap; report done, failed and skipped exactly. Use fields allowed by the live schema.

Sending, publishing, paying and archiving keep Era's existing approval cards inside the call. Wait for its result; do not repeat the write while the card is waiting. A refusal is final for that request. Connection loss or timeout does not prove a write failed: inspect the ledger or record before considering another submission. Exit codes: 0 success, 2 input, 3 session, 4 permission/approval refusal, 5 failed/partial operation, 6 connection/protocol, 7 timeout.

The session supplies ERA_CLI_URL, ERA_CLI_TOKEN, ERA_BASE_URL and ERA_TOKEN in the environment: local doors on this computer that act as this person and end with the session. Never print, copy into a command, persist or share them, and never put them in a file or a page. If missing, report that this terminal has no Era session; do not search for another person's keys and do not run \`era login\`.
`,
} as const;
