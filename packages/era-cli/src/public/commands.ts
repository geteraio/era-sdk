import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { login, logout } from "./auth.ts";
import { loadCredentials, profileName, DEFAULT_BASE_URL } from "./config.ts";
import { api, CliError, EXIT, openSession, type Session } from "./http.ts";
import { imagesCommand } from "./images.ts";

/**
 * `era` — Era's public command line (R52 C1). Everything here goes through the
 * public API with the signed-in person's own permissions; nothing is special.
 * The in-chat terminal command (Era sessions, ERA_CLI_URL) is runtime.ts.
 */

export const HELP = `era — Era from your terminal

Sign in
  era login [--base-url URL] [--scope "crm retail:read"] [--no-browser]   sign in with your browser (OAuth)
  era logout                                                            sign out and revoke the token
  era whoami [--json]                                                   who, which workspace, what you may do

Your data (every model and every action of every module)
  era resources                                    what you can read here
  era <resource> list [--status paid] [--where "total[gte]=100"] [--limit 20] [--all] [--json]
  era <resource> get <id> [--json]
  era <resource> create|update <id>|delete <id> [--field value …] [--data JSON|@file|-]
  era <resource> <action> [<id>] [--field value …]      e.g. era orders cancel_order <id>
  era <module> <action> [--field value …]                e.g. era crm capture_lead --name "Ada"
  era actions [<module>]                                 every action you may run, with its fields
  era run <module.action> [--data JSON]                  any action by its full name
  era api <GET|POST|PATCH|DELETE> <path> [--data JSON]   any API call (path starts with /api/v1)

Messages (fail clearly when the channel is not connected)
  era channels                                           which channels are connected
  era whatsapp send --customer <id> --text "…"           also: era sms send …
  era email send --to a@b.com --subject "…" --text "…"

Sites
  era templates [--json]                                   the 31 site templates (name, vertical, look)
  era init [dir] [--template store|blog|services|<name>] [--site <id>]   start a site from a template
  era dev [dir] [--port 4321]                              preview with live rebuilds (needs Bun)
  era build [dir] [--out dist]                             build the static site
  era deploy [dir] [--site <id>] [--provider local]        build and publish to <slug>.getera.site
                                                           (a folder with index.html and no template.ts
                                                           is published as it is: your own code)
  era domains list [--site <id>] | add <domain> [--site <id>]
  era theme check [dir]                                    validate era.theme.json (sections + settings) against Era
  era theme import [dir] [--site <id>] [--prune]           register it: the owner edits those sections in Era's theme editor
  era theme pull [dir] [--site <id>]                       the owner's current values → era.theme.values.json (read before editing)
                                                           (era deploy imports era.theme.json by itself)

Pictures (your own ChatGPT plan through the Codex CLI; no paid image API)
  era images generate --prompt "…" --out img/hero.webp [--style "…"] [--size landscape] [--ref earlier.webp]
  era images status                                        is Codex signed in with ChatGPT?  (more: era images help)

Era Brain (memory for you and your AI agents)
  era brain add "<what to remember>" [--private] [--wait]   era brain search "<question>"
  era brain graph "<question>"   era brain forget <id>   era brain setup claude|codex   (more: era brain help)

Connected apps (one gateway: built-in connectors, vendors' MCP servers, Era channels)
  era apps list [words] [--connected]                    the catalogue, what you have connected
  era apps tools <app>                                   its tools (reads / changes)
  era apps call <app> <tool> [--data JSON]               run one, as you, with your permissions

AI assistants
  era mcp [--client claude|codex|cursor]                 how to connect Claude Code, Codex or Cursor over MCP

Flags: --json (raw JSON out), --profile <name>, --base-url <url>. Env: ERA_API_KEY or ERA_TOKEN (CI), ERA_BASE_URL.
Exit codes: 0 ok · 2 bad input · 3 not signed in · 4 refused (permission, not found, precondition) · 5 failed · 6 connection · 7 timeout.
Docs: https://docs.getera.io/cli
`;

interface Parsed {
  words: string[];
  flags: Map<string, string[]>;
}

export function parse(argv: readonly string[]): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  const bare = new Set(["json", "all", "no-browser", "help", "yes", "text", "private", "graph", "apply"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h") { flags.set("help", ["true"]); continue; }
    if (!a.startsWith("--")) { words.push(a); continue; }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    let value = eq < 0 ? undefined : a.slice(eq + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (bare.has(name) || next === undefined || (next.startsWith("--") && next.length > 2)) value = "true";
      else { value = next; i++; }
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { words, flags };
}

const flag = (p: Parsed, name: string) => p.flags.get(name)?.at(-1);
const has = (p: Parsed, name: string) => p.flags.has(name);
const snake = (s: string) => s.replace(/-/g, "_");
const CONTROL = new Set(["json", "all", "profile", "base-url", "data", "limit", "cursor", "order", "fields", "q", "where", "help", "site", "yes", "text", "idempotency-key", "scope", "no-browser", "port", "out", "template", "client", "provider", "lang"]);

async function readData(raw: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (raw === undefined) return undefined;
  let text = raw;
  if (raw === "-") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(Buffer.from(c));
    text = Buffer.concat(chunks).toString("utf8");
  } else if (raw.startsWith("@")) {
    text = await readFile(raw.slice(1), "utf8").catch(() => { throw new CliError(`Cannot read ${raw.slice(1)}.`, EXIT.input); });
  }
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new CliError("--data must be a JSON object (inline, @file.json or - for stdin).", EXIT.input);
  }
}

interface CallableAction {
  name: string;
  module: string;
  moduleLabel: string;
  label: string;
  summary: string;
  requires: string;
  path: string;
  resourcePath?: string;
  idField?: string;
  preconditions: { code: string; describe: string }[];
  input: { properties?: Record<string, { type?: string | string[]; enum?: unknown[]; title?: string; description?: string; format?: string }>; required?: string[] };
}

/** Flags → an action's input, typed by its schema (`--amount 12.5` is a number, `--paid true` a boolean). */
function inputFrom(p: Parsed, action: CallableAction | undefined, base: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  const props = action?.input.properties ?? {};
  const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  for (const [rawName, values] of p.flags) {
    if (CONTROL.has(rawName)) continue;
    const candidates = [rawName, snake(rawName), camel(rawName)];
    const name = candidates.find((c) => c in props) ?? (Object.keys(props).length ? null : snake(rawName));
    if (!name) throw new CliError(`--${rawName} is not a field of ${action?.name}. Fields: ${Object.keys(props).join(", ")}`, EXIT.input);
    const value = values.at(-1)!;
    const type = props[name]?.type;
    const t = Array.isArray(type) ? type[0] : type;
    if (t === "number" || t === "integer") {
      if (!/^-?\d+(\.\d+)?$/.test(value)) throw new CliError(`--${rawName} needs a number.`, EXIT.input);
      out[name] = Number(value);
    } else if (t === "boolean") out[name] = value === "true" || value === "1" || value === "yes";
    else if (!t && /^[[{]/.test(value)) {
      try { out[name] = JSON.parse(value); } catch { out[name] = value; }
    } else out[name] = value;
  }
  return out;
}

function print(p: Parsed, value: unknown, human?: () => string): void {
  if (has(p, "json") || !human) process.stdout.write(`${JSON.stringify(value, null, has(p, "json") ? 2 : 0)}\n`);
  else process.stdout.write(`${human()}\n`);
}

const PREFERRED = ["id", "number", "name", "title", "full_name", "email", "status", "stage", "total_gross_amount", "total_amount", "amount", "currency", "starts_at", "created_at"];
function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(nothing)";
  const keys = Object.keys(rows[0]!).filter((k) => k !== "organization_id" && k !== "workspace_id");
  const cols = [...PREFERRED.filter((k) => keys.includes(k)), ...keys.filter((k) => !PREFERRED.includes(k))].slice(0, 6);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.length > 36 ? `${s.slice(0, 35)}…` : s;
  };
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join("  ");
  return [line(cols), line(widths.map((w) => "─".repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}

interface ResourceInfo {
  name: string;
  module: string;
  table: string;
  create: string | null;
  update: string | null;
  delete: string | null;
  actions: Record<string, { action: string; on: "record" | "collection"; id_field: string | null }>;
}

async function catalog(s: Session) {
  const [index, actions] = await Promise.all([
    api<{ version: string; resources: ResourceInfo[] }>(s, "GET", "/api/v1"),
    api<{ data: CallableAction[] }>(s, "GET", "/api/v1/actions"),
  ]);
  return { resources: new Map(index.resources.map((r) => [r.name, r])), actions: new Map(actions.data.map((a) => [a.name, a])) };
}

function listQuery(p: Parsed): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of ["limit", "cursor", "order", "fields", "q"]) if (flag(p, k)) q[k] = flag(p, k)!;
  for (const w of p.flags.get("where") ?? []) {
    const m = /^([a-z_][a-z0-9_]*(?:\[[a-z]+\])?)=(.*)$/.exec(w);
    if (!m) throw new CliError(`--where needs column=value or column[op]=value, got "${w}".`, EXIT.input);
    q[m[1]!] = m[2]!;
  }
  for (const [k, v] of p.flags) if (!CONTROL.has(k)) q[snake(k)] = v.at(-1)!;
  return q;
}

const CHANNEL_NAMES: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", instagram: "Instagram" };

async function sendMessage(s: Session, p: Parsed, channel: "whatsapp" | "sms" | "email") {
  const channels = await api<Record<string, { connected: boolean }>>(s, "GET", "/api/v1/channels");
  if (!channels[channel]?.connected) {
    throw new CliError(`${CHANNEL_NAMES[channel]} is not connected — connect it in Settings → Integrations (${s.baseUrl}/settings/integrations). Nothing was sent.`, EXIT.refused);
  }
  const text = flag(p, "text");
  if (!text) throw new CliError("--text is required.", EXIT.input);
  if (channel === "email" && flag(p, "to")) {
    const subject = flag(p, "subject");
    if (!subject) throw new CliError("--subject is required.", EXIT.input);
    return api(s, "POST", "/api/v1/actions/notifications.send_email", { body: { to: flag(p, "to"), subject, text, event_name: "cli.email" }, idempotencyKey: randomUUID() });
  }
  const customer = flag(p, "customer");
  if (!customer) throw new CliError("--customer <id> is required (find one with: era customers list --q <name>).", EXIT.input);
  return api(s, "POST", "/api/v1/actions/notifications.send_customer_message", {
    body: { customer_id: customer, medium: channel, text, subject: flag(p, "subject"), event_name: `cli.${channel}` },
    idempotencyKey: randomUUID(),
  });
}

interface Templates {
  templateNames(): string[];
  listTemplates(locale: string): Promise<{ name: string; vertical: string; products: number; posts: number; services: number }[]>;
  scaffold(name: string, dest: string, opts: { siteId?: string; apiBase?: string }): Promise<string>;
  serveSite(opts: { dir: string; port?: number }): Promise<unknown>;
  renderSite(opts: { dir: string; out: string; quiet?: boolean; config?: { siteId?: string; apiBase?: string; publishableKey?: string } }): Promise<{ pages: string[]; bytes: number }>;
}

const isBun = () => typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

/**
 * Template work (init, dev, build) runs TypeScript, so it needs Bun. Under Node (an Era chat's
 * terminal runs this file with the desktop's own runtime) the same command runs again with `bun`
 * when it is installed. Answers the exit code, or null when this already is Bun.
 */
async function underBun(argv: readonly string[]): Promise<number | null> {
  if (isBun()) return null;
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync("bun", [process.argv[1]!, ...argv], { stdio: "inherit", env: process.env });
  const missing = run.error || run.status === null || (process.platform === "win32" && run.status === 9009);
  if (missing) {
    throw new CliError('Site templates need Bun (https://bun.sh). Install it once (Windows: powershell -c "irm bun.sh/install.ps1 | iex"; macOS/Linux: curl -fsSL https://bun.sh/install | bash), then run the command again.', EXIT.input);
  }
  return run.status ?? EXIT.failed;
}

/**
 * Where @getera/templates is: ERA_TEMPLATES_DIR (Era's desktop sets it to the copy it has), else
 * the project's own node_modules (`bun add -d @getera/templates`), else wherever this file resolves it.
 */
function templatesDir(from: string): string | null {
  const env = process.env.ERA_TEMPLATES_DIR;
  if (env && existsSync(join(env, "src", "index.ts"))) return env;
  // Running from Era's own repository (packages/era-cli next to packages/era-templates) before `bun install` linked it.
  try {
    const sibling = fileURLToPath(new URL("../../../era-templates/", import.meta.url));
    if (existsSync(join(sibling, "src", "index.ts"))) return sibling;
  } catch { /* not a file URL (bundled) */ }
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "node_modules", "@getera", "templates");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const up = resolve(dir, "..");
    if (up === dir) return null;
    dir = up;
  }
}

/** A scaffolded template imports `@getera/templates/kit`: make that resolve inside the project. */
async function linkTemplates(project: string): Promise<void> {
  // ERA_TEMPLATES_DIR, an install above the project, or Era's own repository (templatesDir) — R52 C13: only the env var was linked.
  const env = process.env.ERA_TEMPLATES_DIR || templatesDir(project);
  if (!env || existsSync(join(project, "node_modules", "@getera", "templates"))) return;
  const { mkdir, symlink } = await import("node:fs/promises");
  await mkdir(join(project, "node_modules", "@getera"), { recursive: true });
  await symlink(env, join(project, "node_modules", "@getera", "templates"), process.platform === "win32" ? "junction" : "dir").catch(() => undefined);
}

/** @getera/templates (Bun): scaffold, preview and build a code site. */
async function templates(from = "."): Promise<Templates> {
  if (!isBun()) throw new CliError("Site templates need Bun (https://bun.sh).", EXIT.input);
  const dir = templatesDir(from);
  try {
    if (dir) return (await import(pathToFileURL(join(dir, "src", "index.ts")).href)) as Templates;
    const name = "@getera/templates";
    return (await import(name)) as Templates;
  } catch {
    throw new CliError("Site templates are not installed. Run: bun add -d @getera/templates", EXIT.input);
  }
}

/** The files of a site folder written by hand (or by an AI): everything but dot folders and node_modules. */
async function ownSiteFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      // The theme manifest and Era's pulled values are for Era, not for visitors.
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "era.theme.json" || e.name === "era.theme.values.json") continue;
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else out.push(f);
    }
  };
  await walk(root);
  return out;
}

/** era.theme.json (the sections the owner edits in Era) in the folder or its parent (a build output's project). */
async function themeManifestOf(dir: string): Promise<unknown | null> {
  for (const d of [dir, resolve(dir, "..")]) {
    const file = join(d, "era.theme.json");
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      throw new CliError(`${file} is not valid JSON: ${(e as Error).message}`, EXIT.input);
    }
  }
  return null;
}

async function siteConfig(dir: string): Promise<{ siteId?: string; apiBase?: string; template?: string; publishableKey?: string }> {
  try {
    return JSON.parse(await readFile(join(dir, "era.config.json"), "utf8"));
  } catch {
    return {};
  }
}

async function filesOf(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else out.push(f);
    }
  };
  await walk(root);
  return out;
}

const AGENTS_MD = (base: string) => `# This site is built on Era

Era holds the business's real data (products, prices, stock, orders, bookings, blog posts, forms).
Use it, never hard-code it.

- Read and write through the API: \`@getera/sdk\` in code (\`createEra({ apiKey })\` on a server,
  the site's publishable key in the browser), \`era\` in the terminal (\`era products list --json\`,
  \`era actions retail\`). Every model and action: https://docs.getera.io/api
- Preview: \`era dev\` · Publish: \`era deploy\` (to <slug>.getera.site) · Domains: \`era domains add\`.
- Checkout always goes through Era's hosted checkout — never collect card details here.
- A channel that is not connected (WhatsApp, SMS, email) fails with a clear message; never fall back
  to another channel silently.

API base: ${base}
`;

export async function runPublic(argv: readonly string[]): Promise<number> {
  const p = parse(argv);
  const [cmd, ...rest] = p.words;
  const profile = profileName(flag(p, "profile"));
  const log = (s: string) => process.stderr.write(`${s}\n`);
  if (!cmd || cmd === "help" || has(p, "help")) {
    process.stdout.write(HELP);
    return 0;
  }

  // R52 C13: four built-in commands share their name with a module or a resource (`resources`, `apps`, `build`, `domains`).
  // When the next word is not one of the built-in's own, the words mean the module/resource: `era resources list`,
  // `era apps register_installation`, `era build create_project`, `era domains get <id>`.
  const own: Record<string, (w: string) => boolean> = {
    resources: () => false,
    apps: (w) => ["list", "search", "tools", "call"].includes(w),
    build: (w) => !/^[a-z][a-z0-9_]*$/.test(w) || existsSync(resolve(w)),
    domains: (w) => ["list", "add"].includes(w),
  };
  const toGeneric = cmd in own && rest[0] !== undefined && !own[cmd]!(rest[0]);

  if (!toGeneric) switch (cmd) {
    case "login": {
      await login({ profile, baseUrl: flag(p, "base-url"), scope: flag(p, "scope"), noBrowser: has(p, "no-browser"), log });
      const s = await openSession(profile);
      const me = await api<{ user: { name: string }; workspace: { id: string }; modules: Record<string, string[]> }>(s, "GET", "/api/v1/me");
      log(`\n  Signed in as ${me.user.name} — workspace ${me.workspace.id} — ${Object.keys(me.modules).length} modules.`);
      return 0;
    }
    case "logout": {
      const done = await logout(profile);
      log(done ? "Signed out; the token is revoked." : "You were not signed in.");
      return 0;
    }
    case "whoami": {
      const s = await openSession(profile, flag(p, "base-url"));
      const me = await api<{ user: { id: string; name: string }; workspace: { id: string }; credential: { kind: string; scopes: string[] }; modules: Record<string, string[]>; brain?: { read: boolean; write: boolean } }>(s, "GET", "/api/v1/me");
      print(p, me, () =>
        [
          `${me.user.name}  (${me.user.id})`,
          `workspace  ${me.workspace.id}`,
          `signed in  ${me.credential.kind === "oauth" ? "era login" : me.credential.kind === "key" ? "API key" : "session"}  ·  ${s.baseUrl}`,
          `scopes     ${me.credential.scopes.join(" ")}`,
          `modules    ${Object.entries(me.modules).map(([m, c]) => `${m}(${c.join(",")})`).join(" ") || "—"}`,
          `brain      ${me.brain?.write ? "read + write" : me.brain?.read ? "read" : "no access"}`,
        ].join("\n")
      );
      return 0;
    }
    case "api": {
      const [method, path] = rest;
      if (!method || !path || !path.startsWith("/")) throw new CliError("era api <METHOD> </api/v1/...> [--data JSON]", EXIT.input);
      const s = await openSession(profile, flag(p, "base-url"));
      const q: Record<string, string> = {};
      for (const kv of p.flags.get("query") ?? []) {
        const i = kv.indexOf("=");
        if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1);
      }
      print(p, await api(s, method.toUpperCase(), path, { query: q, body: await readData(flag(p, "data")), idempotencyKey: flag(p, "idempotency-key") }));
      return 0;
    }
    case "resources": {
      const s = await openSession(profile, flag(p, "base-url"));
      const { resources } = await catalog(s);
      const rows = [...resources.values()].map((r) => ({ resource: r.name, module: r.module, actions: Object.keys(r.actions).length }));
      print(p, rows, () => table(rows));
      return 0;
    }
    case "actions": {
      const s = await openSession(profile, flag(p, "base-url"));
      const { actions } = await catalog(s);
      const list = [...actions.values()].filter((a) => !rest[0] || a.module === snake(rest[0]) || a.name === rest[0]);
      if (rest[0]?.includes(".") && list.length === 1) {
        const a = list[0]!;
        print(p, a, () =>
          [
            `${a.name} — ${a.label}`,
            a.summary,
            `needs ${a.module}:${a.requires} · POST ${a.resourcePath ?? a.path}`,
            "fields:",
            ...Object.entries(a.input.properties ?? {}).map(([k, v]) => `  --${k.replace(/_/g, "-")}${(a.input.required ?? []).includes(k) ? " (required)" : ""}  ${v.title ?? ""}${v.enum ? ` [${v.enum.join("|")}]` : ""}`),
            ...(a.preconditions.length ? ["refuses with:", ...a.preconditions.map((r) => `  ${r.code}: ${r.describe}`)] : []),
          ].join("\n")
        );
        return 0;
      }
      const rows = list.map((a) => ({ action: a.name, label: a.label, needs: a.requires }));
      print(p, rows, () => table(rows));
      return 0;
    }
    case "run": {
      const name = rest[0];
      if (!name?.includes(".")) throw new CliError("era run <module.action> [--field value] [--data JSON]", EXIT.input);
      const s = await openSession(profile, flag(p, "base-url"));
      const { actions } = await catalog(s);
      const a = actions.get(name);
      if (!a) throw new CliError(`${name} is not an action you may run here (era actions lists them).`, EXIT.refused);
      print(p, await api(s, "POST", `/api/v1/actions/${name}`, { body: inputFrom(p, a, await readData(flag(p, "data"))), idempotencyKey: flag(p, "idempotency-key") ?? randomUUID() }));
      return 0;
    }
    case "brain":
      return brainCommand(p, rest, profile, log);
    case "apps": {
      // R52 C12: the integrations gateway — era apps [list [words]] | tools <app> | call <app> <tool> [--data JSON] [--connection mine|workspace|<id>]
      const s = await openSession(profile, flag(p, "base-url"));
      const [sub = "list", app, tool] = rest;
      if (sub === "list" || sub === "search") {
        const out = await api<{ data: { id: string; name: string; category: string; connected: boolean; toolCount: number | null; kinds: string[] }[]; coverage: Record<string, number> }>(s, "GET", "/api/v1/apps", {
          query: { ...(rest.slice(1).length ? { q: rest.slice(1).join(" ") } : {}), ...(has(p, "connected") ? { connected: "true" } : {}), ...(flag(p, "provider") ? { provider: flag(p, "provider")! } : {}) },
        });
        const rows = out.data.map((a) => ({ app: a.id, name: a.name, category: a.category, connected: a.connected ? "yes" : "", tools: a.toolCount ?? "", via: (a.kinds ?? []).join("+") }));
        print(p, out, () => `${table(rows)}\n\n${out.coverage ? `${out.coverage.apps} apps · ${out.coverage.tools} tools · ${out.coverage.triggers} triggers · ${out.coverage.connected} connected` : ""}`);
        return 0;
      }
      if (sub === "tools") {
        if (!app) throw new CliError("era apps tools <app>", EXIT.input);
        const out = await api<{ data: { name: string; title?: string; readOnly: boolean }[] }>(s, "GET", `/api/v1/apps/${encodeURIComponent(app)}/tools`, { query: flag(p, "connection") ? { connection: flag(p, "connection")! } : {} });
        const rows = out.data.map((t) => ({ tool: t.name, title: t.title ?? "", kind: t.readOnly ? "reads" : "changes" }));
        print(p, out.data, () => table(rows));
        return 0;
      }
      if (sub === "call") {
        if (!app || !tool) throw new CliError("era apps call <app> <tool> [--data JSON] [--connection mine|workspace|<id>]", EXIT.input);
        const out = await api<{ data: { content?: unknown; structuredContent?: unknown; isError?: boolean } }>(s, "POST", `/api/v1/apps/${encodeURIComponent(app)}/tools/${encodeURIComponent(tool)}`, {
          body: { arguments: (await readData(flag(p, "data"))) ?? {}, ...(flag(p, "connection") ? { connection: flag(p, "connection") } : {}) },
        });
        print(p, out.data.structuredContent ?? out.data.content ?? out.data);
        return out.data.isError ? EXIT.refused : 0;
      }
      throw new CliError("era apps list [words] [--connected] | era apps tools <app> | era apps call <app> <tool> [--data JSON]", EXIT.input);
    }
    case "memory": {
      if (rest[0] !== "recall" || !rest[1]) throw new CliError('era memory recall "<words>"', EXIT.input);
      const s = await openSession(profile, flag(p, "base-url"));
      const out = await api<{ results: { content: string }[] }>(s, "GET", "/api/v1/memory", { query: { q: rest.slice(1).join(" "), ...(flag(p, "limit") ? { limit: flag(p, "limit")! } : {}) } });
      print(p, out, () => out.results.map((r, i) => `${i + 1}. ${r.content}`).join("\n") || "(nothing)");
      return 0;
    }
    case "channels": {
      const s = await openSession(profile, flag(p, "base-url"));
      const out = await api<Record<string, { connected: boolean; accounts?: { name: string }[] }>>(s, "GET", "/api/v1/channels");
      print(p, out, () => Object.entries(out).filter(([, v]) => typeof v === "object").map(([k, v]) => `${k.padEnd(10)} ${v.connected ? `connected (${v.accounts?.map((x) => x.name).join(", ")})` : "not connected"}`).join("\n"));
      return 0;
    }
    case "whatsapp":
    case "sms":
    case "email": {
      if (rest[0] !== "send") throw new CliError(`era ${cmd} send …  (see era --help)`, EXIT.input);
      const s = await openSession(profile, flag(p, "base-url"));
      print(p, await sendMessage(s, p, cmd), () => `Queued. It goes out through your connected ${CHANNEL_NAMES[cmd]}.`);
      return 0;
    }
    case "instagram":
      throw new CliError("Instagram messages are answered from the inbox: era conversations list --channel instagram, then era conversations reply <id> --content \"…\".", EXIT.input);
    case "mcp": {
      const creds = await loadCredentials();
      const base = (flag(p, "base-url") ?? process.env.ERA_BASE_URL ?? creds.profiles[profile]?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
      const url = `${base}/api/mcp`;
      const client = flag(p, "client");
      const blocks: Record<string, string> = {
        claude: `Claude Code:\n  claude mcp add --transport http era ${url}\n  then in Claude Code: /mcp → era → Authenticate (your browser opens Era's consent card)`,
        codex: `Codex:\n  codex mcp add era --url ${url}\n  codex mcp login era          (opens Era's consent card)`,
        cursor: `Cursor (.cursor/mcp.json):\n  { "mcpServers": { "era": { "url": "${url}" } } }\n  Cursor opens Era's sign-in the first time it connects.`,
      };
      print(p, { url, oauth: `${base}/.well-known/oauth-authorization-server`, clients: blocks }, () =>
        [`Era MCP server: ${url}  (OAuth 2.1 — sign in once, you pick the workspace and what it may reach)`, "", ...(client ? [blocks[client] ?? `Unknown client ${client}`] : Object.values(blocks))].join("\n\n")
      );
      return 0;
    }
    case "templates": {
      const creds = await loadCredentials();
      const base = (flag(p, "base-url") ?? process.env.ERA_BASE_URL ?? creds.profiles[profile]?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
      // Public; a session's bearer rides along when there is one (an Era chat's local door wants it).
      const bearer = await openSession(profile, flag(p, "base-url")).then((x) => x.bearer()).catch(() => null);
      const res = await fetch(`${base}/api/site-templates`, { headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }).catch(() => null);
      if (!res?.ok) throw new CliError(`Could not read the template list from ${base}.`, EXIT.connection);
      const body = (await res.json()) as unknown;
      const list = (Array.isArray(body) ? body : ((body as { templates?: unknown[] }).templates ?? [])) as Array<Record<string, unknown>>;
      const lang = flag(p, "lang") === "en" ? "en" : "tr";
      const text = (v: unknown) => (v && typeof v === "object" ? String((v as Record<string, unknown>)[lang] ?? (v as Record<string, unknown>).en ?? "") : String(v ?? ""));
      const rows = list.map((t) => ({ name: t.name, vertical: t.vertical, title: text(t.title), description: text(t.description).slice(0, 90) }));
      print(p, list, () => table(rows));
      return 0;
    }
    case "init": {
      const bun = await underBun(argv);
      if (bun !== null) return bun;
      const t = await templates();
      const dir = resolve(rest[0] ?? ".");
      const wanted = flag(p, "template") ?? "store";
      const names = t.templateNames();
      let name = names.includes(wanted) ? wanted : undefined;
      if (!name) {
        const all = await t.listTemplates("en");
        const pick = all.find((x) => (wanted === "store" ? x.products > 0 : wanted === "blog" ? x.posts > 0 : wanted === "services" ? x.services > 0 : x.vertical === wanted));
        name = pick?.name;
      }
      if (!name) throw new CliError(`No template "${wanted}". Templates: ${names.join(", ")}`, EXIT.input);
      const creds = await loadCredentials();
      const base = (flag(p, "base-url") ?? process.env.ERA_BASE_URL ?? creds.profiles[profile]?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
      // The scaffolded site talks to Era from the visitor's browser: the public address, never a local door.
      const publicBase = (process.env.ERA_PUBLIC_URL ?? base).replace(/\/$/, "");
      const to = await t.scaffold(name, dir, { siteId: flag(p, "site"), apiBase: publicBase });
      await linkTemplates(to);
      await writeFile(join(to, "AGENTS.md"), AGENTS_MD(publicBase), "utf8");
      log(`Created ${relative(process.cwd(), to) || "."} from "${name}". Next: cd into it, then era dev — and era deploy when it looks right.`);
      return 0;
    }
    case "dev": {
      const bun = await underBun(argv);
      if (bun !== null) return bun;
      const t = await templates(rest[0] ?? ".");
      const dir = resolve(rest[0] ?? ".");
      await t.serveSite({ dir, port: Number(flag(p, "port")) || 4321 });
      await new Promise(() => undefined);
      return 0;
    }
    case "build":
    case "deploy": {
      const dir = resolve(rest[0] ?? ".");
      const provider = flag(p, "provider");
      if (provider && provider !== "local" && provider !== "cloudflare") throw new CliError("--provider is local or cloudflare.", EXIT.input);
      if (!existsSync(join(dir, "template.ts"))) {
        // Your own code: a folder with index.html is published as it is (no build, no Bun).
        if (cmd === "build" || !existsSync(join(dir, "index.html"))) throw new CliError(`${dir} is not an Era site: no template.ts (start one with era init) and no index.html.`, EXIT.input);
        const cfg = await siteConfig(dir);
        const siteId = flag(p, "site") ?? cfg.siteId;
        if (!siteId) throw new CliError("Which site? Pass --site <id> (era sites list) or set siteId in era.config.json.", EXIT.input);
        const s = await openSession(profile, flag(p, "base-url"));
        // The editable sections first: if the theme is refused, nothing is published half-way.
        const theme = await themeManifestOf(dir);
        if (theme) {
          const imported = await api<{ version?: number; created?: number; keptOwnerValues?: number }>(s, "POST", "/api/v1/actions/site.import_theme", { body: { siteId, manifest: theme }, idempotencyKey: randomUUID() });
          const r = (imported as { result?: typeof imported }).result ?? imported;
          log(`Theme imported (version ${r.version ?? "?"}: ${r.created ?? 0} new settings, ${r.keptOwnerValues ?? 0} kept as the owner set them).`);
        }
        const own = await ownSiteFiles(dir);
        // A copy of Era's era-site.js goes up as the current one (the chat's .era/lib is refreshed every session).
        const eraSite = await readFile(join(process.cwd(), ".era", "lib", "era-site.js")).catch(() => null);
        const files = await Promise.all(own.map(async (f) => {
          let bytes = await readFile(f);
          if (eraSite && f.endsWith("era-site.js") && bytes.subarray(0, 40).toString().includes("@getera/storefront")) bytes = eraSite;
          return { path: `/${relative(dir, f).split(sep).join("/")}`, content: bytes.toString("base64") };
        }));
        log(`Uploading ${files.length} files…`);
        const res = await api<{ deploy?: { url?: string; status?: string } }>(s, "POST", `/api/v1/sites/${siteId}/deploy`, {
          body: { kind: "static", files, source: "cli", ...(provider ? { provider } : {}), ...(files.some((f) => f.path === "/404.html") ? { notFound: "404-page" } : {}) },
          idempotencyKey: randomUUID(),
        });
        print(p, res, () => `Live: ${res.deploy?.url ?? "(see the site's deploy log in Era)"}`);
        return 0;
      }
      const bun = await underBun(argv);
      if (bun !== null) return bun;
      const t = await templates(dir);
      const out = flag(p, "out") ? resolve(flag(p, "out")!) : cmd === "build" ? join(dir, "dist") : await mkdtemp(join(tmpdir(), "era-deploy-"));
      // The site's own config goes into the pages (checkout, forms, live prices need its id and Era's public address).
      const pre = await siteConfig(dir);
      const config = { siteId: flag(p, "site") || pre.siteId || undefined, apiBase: pre.apiBase || process.env.ERA_PUBLIC_URL || undefined, publishableKey: pre.publishableKey || undefined };
      const built = await t.renderSite({ dir, out, quiet: true, config });
      if (cmd === "build") {
        log(`Built ${built.pages.length} pages into ${relative(process.cwd(), out)} (${(built.bytes / 1024).toFixed(0)} KB).`);
        return 0;
      }
      const cfg = await siteConfig(dir);
      const siteId = flag(p, "site") || cfg.siteId;
      if (!siteId) throw new CliError("Which site? Pass --site <id> (era sites list) or set siteId in era.config.json.", EXIT.input);
      const s = await openSession(profile, flag(p, "base-url"));
      const files = await Promise.all(
        (await filesOf(out)).map(async (f) => ({ path: `/${relative(out, f).split(sep).join("/")}`, content: (await readFile(f)).toString("base64") }))
      );
      log(`Uploading ${files.length} files…`);
      const res = await api<{ deploy?: { url?: string; status?: string } }>(s, "POST", `/api/v1/sites/${siteId}/deploy`, { body: { kind: "static", files, source: "cli", ...(provider ? { provider } : {}) }, idempotencyKey: randomUUID() });
      await rm(out, { recursive: true, force: true }).catch(() => undefined);
      print(p, res, () => `Live: ${res.deploy?.url ?? "(see the site's deploy log in Era)"}`);
      return 0;
    }
    case "images": {
      return imagesCommand(rest, { get: (n) => flag(p, n), all: (n) => p.flags.get(n) ?? [], has: (n) => has(p, n) }, log, (value, human) => print(p, value, human));
    }
    case "theme": {
      const sub = rest[0] ?? "help"
      const dir = resolve(rest[1] ?? ".")
      if (sub !== "check" && sub !== "import" && sub !== "pull") throw new CliError("era theme check|import|pull [dir] [--site <id>]", EXIT.input)
      const cfg = await siteConfig(dir)
      const siteId = flag(p, "site") ?? cfg.siteId
      if (!siteId) throw new CliError("Which site? Pass --site <id> (era sites list) or set siteId in era.config.json.", EXIT.input)
      const s = await openSession(profile, flag(p, "base-url"))
      if (sub === "pull") {
        const res = await api<{ data?: Record<string, unknown>[] }>(s, "GET", `/api/v1/site_contents?site_id=${encodeURIComponent(siteId)}&limit=500`)
        const values: Record<string, unknown> = {}
        for (const row of res.data ?? []) values[String(row.key)] = row.value
        const target = join(dir, "era.theme.values.json")
        await writeFile(target, `${JSON.stringify(values, null, 2)}\n`)
        print(p, { file: target, entries: Object.keys(values).length }, () => `${Object.keys(values).length} values → ${relative(process.cwd(), target) || target}`)
        return 0
      }
      const manifest = await themeManifestOf(dir)
      if (!manifest) throw new CliError(`No era.theme.json in ${dir} (or its parent).`, EXIT.input)
      const res = await api<Record<string, unknown>>(s, "POST", "/api/v1/actions/site.import_theme", {
        body: { siteId, manifest, ...(sub === "check" ? { dryRun: true } : {}), ...(has(p, "prune") ? { prune: true } : {}) },
        idempotencyKey: randomUUID(),
      })
      print(p, res, () => JSON.stringify(res, null, 2))
      return 0
    }
    case "domains": {
      const s = await openSession(profile, flag(p, "base-url"));
      const cfg = await siteConfig(resolve("."));
      const siteId = flag(p, "site") ?? cfg.siteId;
      if (rest[0] === "add") {
        if (!rest[1]) throw new CliError("era domains add <domain> [--site <id>]", EXIT.input);
        if (!siteId) throw new CliError("Which site? Pass --site <id>.", EXIT.input);
        const res = await api(s, "POST", "/api/v1/actions/site.add_domain", { body: { siteId, host: rest[1] }, idempotencyKey: randomUUID() });
        print(p, res, () => `Added ${rest[1]}. Point its DNS as shown in Era → Website → Domains, then it verifies by itself.`);
        return 0;
      }
      const res = await api<{ data: Record<string, unknown>[] }>(s, "GET", "/api/v1/domains", { query: siteId ? { site_id: siteId } : {} });
      print(p, res, () => table(res.data));
      return 0;
    }
  }

  // era <resource> … or era <module> <action> …
  const s = await openSession(profile, flag(p, "base-url"));
  const { resources, actions } = await catalog(s);
  let resource = resources.get(snake(cmd));
  // R52 C13: a module and a resource can share a name (invoices, quotes, campaigns, files…). `era <module> <action>`
  // wins when the resource cannot do that verb, or would need an <id> that was not given (the action takes it in --data).
  if (resource && rest[0] && rest[0] !== "list" && rest[0] !== "get" && actions.has(`${snake(cmd)}.${snake(rest[0])}`)) {
    const v = snake(rest[0]);
    const route = resource.actions[v];
    const crud = v === "create" ? resource.create : v === "update" ? resource.update : v === "delete" ? resource.delete : null;
    const needsId = route ? route.on === "record" : v === "update" || v === "delete";
    if ((!route && !crud) || (needsId && !rest[1])) resource = undefined;
  }
  if (resource) {
    const [verb = "list", id] = rest;
    const base = `/api/v1/${resource.name}`;
    const data = await readData(flag(p, "data"));
    // A resource without a REST create/update/delete may still have an action of that name (popups.delete): use it.
    const crudMissing = (verb === "create" && !resource.create) || (verb === "update" && !resource.update) || (verb === "delete" && !resource.delete);
    switch (crudMissing && resource.actions[snake(verb)] ? "__action" : verb) {
      case "list": {
        if (has(p, "all")) {
          const all: Record<string, unknown>[] = [];
          let cursor: string | undefined;
          do {
            const page = await api<{ data: Record<string, unknown>[]; next_cursor: string | null }>(s, "GET", base, { query: { ...listQuery(p), limit: "200", ...(cursor ? { cursor } : {}) } });
            all.push(...page.data);
            cursor = page.next_cursor ?? undefined;
          } while (cursor);
          print(p, all, () => table(all));
        } else {
          const page = await api<{ data: Record<string, unknown>[]; next_cursor: string | null }>(s, "GET", base, { query: listQuery(p) });
          print(p, page, () => `${table(page.data)}${page.next_cursor ? `\n… more: --cursor ${page.next_cursor}` : ""}`);
        }
        return 0;
      }
      case "get": {
        if (!id) throw new CliError(`era ${cmd} get <id>`, EXIT.input);
        const one = await api<{ data: Record<string, unknown> }>(s, "GET", `${base}/${id}`);
        print(p, one.data, () => Object.entries(one.data).map(([k, v]) => `${k.padEnd(24)} ${v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n"));
        return 0;
      }
      case "create":
      case "update":
      case "delete": {
        const name = verb === "create" ? resource.create : verb === "update" ? resource.update : resource.delete;
        if (!name) throw new CliError(`${resource.name} has no ${verb}; era actions ${resource.module} lists what you can run.`, EXIT.input);
        if (verb !== "create" && !id) throw new CliError(`era ${cmd} ${verb} <id>`, EXIT.input);
        const body = verb === "delete" ? undefined : inputFrom(p, actions.get(name), data);
        const method = verb === "create" ? "POST" : verb === "update" ? "PATCH" : "DELETE";
        print(p, await api(s, method, verb === "create" ? base : `${base}/${id}`, { body, idempotencyKey: flag(p, "idempotency-key") ?? randomUUID() }), () => `Done (${name}).`);
        return 0;
      }
      default: {
        const route = resource.actions[snake(verb)];
        if (!route) throw new CliError(`"${verb}" is not something you can do to ${resource.name}. Try: ${["list", "get", ...Object.keys(resource.actions)].join(", ")}`, EXIT.input);
        if (route.on === "record" && !id) throw new CliError(`era ${cmd} ${verb} <id>`, EXIT.input);
        const path = route.on === "record" ? `${base}/${id}/actions/${snake(verb)}` : `${base}/actions/${snake(verb)}`;
        print(p, await api(s, "POST", path, { body: inputFrom(p, actions.get(route.action), data), idempotencyKey: flag(p, "idempotency-key") ?? randomUUID() }));
        return 0;
      }
    }
  }
  const action = rest[0] ? actions.get(`${snake(cmd)}.${snake(rest[0])}`) : undefined;
  if (action) {
    print(p, await api(s, "POST", `/api/v1/actions/${action.name}`, { body: inputFrom(p, action, await readData(flag(p, "data"))), idempotencyKey: flag(p, "idempotency-key") ?? randomUUID() }));
    return 0;
  }
  const moduleHas = [...actions.values()].some((a) => a.module === snake(cmd));
  throw new CliError(
    moduleHas
      ? `"${rest[0] ?? ""}" is not an action of ${cmd} you may run. era actions ${cmd} lists them.`
      : `Unknown command or resource "${cmd}" (or not one you can use here). era resources · era actions · era --help`,
    EXIT.input
  );
}

// ── Era Brain (R52 · C10) ────────────────────────────────────────────────────

interface BrainMemoryOut { id: string; content: string; kind?: string; visibility?: string; source?: { kind: string | null; label: string | null }; created_at?: string }
interface BrainHopOut { from: string; relation: string; to: string; evidence?: string | null }

const short = (id: string) => id.slice(0, 8);
const hopsLine = (hops: BrainHopOut[]) => hops.map((h) => `${h.from} —${h.relation}→ ${h.to}`).join("  ·  ");

/** `era brain …` — the memory alone, with the signed-in person's own permissions. */
async function brainCommand(p: Parsed, rest: string[], profile: string, log: (s: string) => void): Promise<number> {
  const [sub, ...args] = rest;
  const text = args.join(" ").trim();
  const base = "/api/v1/brain";
  if (!sub || sub === "help") {
    process.stdout.write(BRAIN_HELP);
    return sub ? 0 : EXIT.input;
  }
  if (sub === "setup") return brainSetup(p, args[0], profile, log);
  const s = await openSession(profile, flag(p, "base-url"));
  switch (sub) {
    case "add": {
      const from = flag(p, "file");
      const body: Record<string, unknown> = {};
      if (from) body.text = await readFile(resolve(from), "utf8");
      // One sentence is stored as given; a longer text is extracted into facts by your workspace's AI.
      else if (text.length >= 3 && text.length <= 500 && !text.includes("\n")) body.facts = [{ statement: text }];
      else if (text.length >= 20) body.text = text;
      else throw new CliError('era brain add "<what to remember>" [--private] [--label "…"] [--module crm] [--wait]', EXIT.input);
      if (has(p, "private")) body.visibility = "private";
      if (flag(p, "module")) body.module = flag(p, "module");
      if (flag(p, "label") || flag(p, "ref") || flag(p, "source")) {
        body.source = { ...(flag(p, "source") ? { kind: flag(p, "source") } : {}), ...(flag(p, "label") ? { label: flag(p, "label") } : {}), ...(flag(p, "ref") ? { ref: flag(p, "ref") } : {}) };
      }
      const w = flag(p, "wait");
      if (w) body.wait = w === "true" ? 15 : Math.min(20, Math.max(0, Number(w) || 0));
      const out = await api<{ job: { id: string; status: string; error: string | null; waiting_for?: string; pending_approval?: number }; memories?: BrainMemoryOut[] }>(s, "POST", `${base}/memories`, { body, idempotencyKey: flag(p, "idempotency-key") ?? randomUUID() });
      print(p, out, () => {
        if (out.job.pending_approval) return `Waiting for approval: ${out.job.pending_approval} fact(s) are suggestions on the Era Brain screen (this brain asks first).`;
        if (out.job.status === "done") return out.memories?.length ? ["Remembered:", ...out.memories.map((m) => `  ${short(m.id)}  ${m.content}`)].join("\n") : "Done — Brain already knew this (or decided it was not worth keeping).";
        if (out.job.status === "failed") return `Brain could not process it: ${out.job.error ?? "unknown error"}`;
        if (out.job.status === "waiting") return `Accepted, waiting: ${out.job.waiting_for ?? "the worker needs an AI to file it"} (job ${out.job.id})`;
        return `Accepted — Brain is filing it (job ${out.job.id}). Searchable in a moment; check with: era brain job ${out.job.id}`;
      });
      return out.job.status === "failed" ? EXIT.failed : 0;
    }
    case "search": {
      if (!text) throw new CliError('era brain search "<question>" [--limit 10] [--graph]', EXIT.input);
      const out = await api<{ results: { id: string; content: string; score: number; earlier?: boolean }[]; paths?: { hops: BrainHopOut[] }[] }>(s, "POST", `${base}/search`, {
        body: { query: text, ...(flag(p, "limit") ? { limit: Number(flag(p, "limit")) } : {}), ...(has(p, "graph") ? { graph: true } : {}) },
      });
      print(p, out, () =>
        [
          ...(out.results.length ? out.results.map((r, i) => `${String(i + 1).padStart(2)}. ${r.content}${r.earlier ? "  (older value)" : ""}\n    ${short(r.id)} · score ${r.score.toFixed(4)}`) : ["(nothing — Brain does not know anything like that yet)"]),
          ...(out.paths?.length ? ["", "Paths:", ...out.paths.map((x) => `  ${hopsLine(x.hops)}`)] : []),
        ].join("\n")
      );
      return 0;
    }
    case "list": {
      const q = flag(p, "q") ?? (text || undefined);
      const out = await api<{ data: BrainMemoryOut[]; next_cursor: string | null }>(s, "GET", `${base}/memories`, {
        query: { ...(q ? { q } : {}), ...(flag(p, "kind") ? { kind: flag(p, "kind")! } : {}), ...(flag(p, "limit") ? { limit: flag(p, "limit")! } : {}), ...(flag(p, "cursor") ? { cursor: flag(p, "cursor")! } : {}) },
      });
      print(p, out, () => (out.data.length ? out.data.map((m) => `${short(m.id)}  ${m.content}${m.visibility === "private" ? "  (private)" : ""}`).join("\n") : "(nothing)") + (out.next_cursor ? `\n… more: --cursor ${out.next_cursor}` : ""));
      return 0;
    }
    case "get": {
      if (!args[0]) throw new CliError("era brain get <memory-id>", EXIT.input);
      const out = await api<{ data: BrainMemoryOut & { entities: { name: string; type: string }[]; history: { content: string }[] } }>(s, "GET", `${base}/memories/${encodeURIComponent(args[0])}`);
      const m = out.data;
      print(p, out, () =>
        [
          m.content,
          `${m.id} · ${m.kind} · ${m.visibility} · from ${m.source?.label ?? m.source?.kind ?? "?"} · ${m.created_at}`,
          ...(m.entities.length ? [`about: ${m.entities.map((e) => `${e.name} (${e.type})`).join(", ")}`] : []),
          ...(m.history.length ? ["replaced:", ...m.history.map((h) => `  ${h.content}`)] : []),
        ].join("\n")
      );
      return 0;
    }
    case "correct": {
      const [id, ...words] = args;
      if (!id || !words.length) throw new CliError('era brain correct <memory-id> "<the right wording>"', EXIT.input);
      const out = await api<{ id: string }>(s, "PATCH", `${base}/memories/${encodeURIComponent(id)}`, { body: { content: words.join(" ") } });
      print(p, out, () => `Corrected (current version ${short(out.id)}).`);
      return 0;
    }
    case "forget": {
      if (!args[0]) throw new CliError("era brain forget <memory-id>", EXIT.input);
      const out = await api(s, "DELETE", `${base}/memories/${encodeURIComponent(args[0])}`);
      print(p, out, () => "Forgotten — Era no longer uses it.");
      return 0;
    }
    case "job": {
      if (!args[0]) throw new CliError("era brain job <job-id>", EXIT.input);
      const out = await api<{ job: { status: string; error: string | null }; memories: BrainMemoryOut[] }>(s, "GET", `${base}/jobs/${encodeURIComponent(args[0])}`);
      print(p, out, () => [`${out.job.status}${out.job.error ? ` — ${out.job.error}` : ""}`, ...out.memories.map((m) => `  ${short(m.id)}  ${m.content}`)].join("\n"));
      return 0;
    }
    case "graph": {
      if (!text) throw new CliError('era brain graph "<question naming people, companies or products>"', EXIT.input);
      const out = await api<{ anchors: { name: string }[]; paths: { hops: BrainHopOut[] }[] }>(s, "GET", `${base}/graph`, { query: { q: text } });
      print(p, out, () =>
        out.paths.length
          ? [`from: ${out.anchors.map((a) => a.name).join(", ")}`, ...out.paths.map((x) => `  ${hopsLine(x.hops)}`)].join("\n")
          : out.anchors.length
            ? `Found ${out.anchors.map((a) => a.name).join(", ")}, but no relations to follow yet.`
            : "(no known person, company or product in that question)"
      );
      return 0;
    }
    case "path": {
      const [a, b] = args;
      if (!a || !b) throw new CliError('era brain path "<entity>" "<entity>"', EXIT.input);
      const out = await api<{ found: boolean; hops: BrainHopOut[] }>(s, "GET", `${base}/paths`, { query: { from: a, to: b, ...(flag(p, "max-depth") ? { max_depth: flag(p, "max-depth")! } : {}) } });
      print(p, out, () => (out.found ? (out.hops.length ? hopsLine(out.hops) : "Same entity.") : "No path between them (within the hops searched)."));
      return 0;
    }
    case "entities": {
      const q = flag(p, "q") ?? (text || undefined);
      const out = await api<{ data: { id: string; name: string; type: string; facts: number }[] }>(s, "GET", `${base}/entities`, { query: { ...(q ? { q } : {}), ...(flag(p, "type") ? { type: flag(p, "type")! } : {}) } });
      print(p, out, () => table(out.data.map((e) => ({ id: short(e.id), name: e.name, type: e.type, facts: e.facts }))));
      return 0;
    }
    case "entity": {
      if (!args[0]) throw new CliError("era brain entity <entity-id>", EXIT.input);
      const out = await api<{ data: { name: string; type: string; relations: { direction: string; relation: string; entity: { name: string } }[]; facts: { content: string }[] } }>(s, "GET", `${base}/entities/${encodeURIComponent(args[0])}`);
      const e = out.data;
      print(p, out, () =>
        [`${e.name} (${e.type})`, ...e.relations.map((r) => (r.direction === "out" ? `  —${r.relation}→ ${r.entity.name}` : `  ←${r.relation}— ${r.entity.name}`)), ...e.facts.slice(0, 8).map((f) => `  · ${f.content}`)].join("\n")
      );
      return 0;
    }
    case "sources": {
      const out = await api<{ connected: { provider: string; label: string | null; status: string }[]; kinds: { kind: string; memories: number }[] }>(s, "GET", `${base}/sources`);
      print(p, out, () => [...out.kinds.map((k) => `${k.kind.padEnd(14)} ${k.memories} memories`), ...out.connected.map((c) => `${(c.label ?? c.provider).padEnd(14)} ${c.status}`)].join("\n") || "(nothing yet)");
      return 0;
    }
    case "explain": {
      const id = args.at(-1);
      const q = args.slice(0, -1).join(" ");
      if (!id || !q) throw new CliError('era brain explain "<question>" <memory-id>', EXIT.input);
      const out = await api<{ returned: boolean; rank: number | null; keyword: { terms: string[] }; semantic: { similarity: number | null }; visible_because: string; note?: string }>(s, "POST", `${base}/explain`, { body: { query: q, memory_id: id } });
      print(p, out, () =>
        [out.returned ? `Returned at #${out.rank}.` : "Not returned for this question.", `keyword terms: ${out.keyword.terms.join(", ") || "none"} · semantic similarity: ${out.semantic.similarity ?? "n/a"}`, out.visible_because, ...(out.note ? [out.note] : [])].join("\n")
      );
      return 0;
    }
    default:
      throw new CliError(`Unknown brain command "${sub}".\n\n${BRAIN_HELP}`, EXIT.input);
  }
}

export const BRAIN_HELP = `era brain — Era Brain, long-term memory (scopes brain:read / brain:write)

  era brain add "<what to remember>" [--private] [--label "Call notes"] [--module crm] [--wait]
  era brain add --file notes.md                         a longer text: Era extracts the facts
  era brain search "<question>" [--limit 10] [--graph]  hybrid recall (+ relationship paths)
  era brain list [--q words] [--kind preference]        what Brain knows now
  era brain get <id>   era brain correct <id> "<right wording>"   era brain forget <id>
  era brain graph "<question>"                          typed paths between the entities it names
  era brain path "<entity>" "<entity>"                  shortest chain of relations
  era brain entities [--q name]   era brain entity <id>   era brain sources   era brain job <id>
  era brain explain "<question>" <id>                   why a fact was (or was not) returned
  era brain setup claude|codex [--apply]                give Claude Code or Codex a memory (MCP over OAuth)
`;

export const BRAIN_AGENTS_MD = `## Memory (Era Brain)

You have a long-term memory through the \`era-brain\` MCP server (tools: search_memory, add_memory, graph_paths, forget_memory).

- Before answering anything about people, customers, preferences, past decisions or ongoing work, call \`search_memory\`.
- When you learn something durable — a stable preference, a decision and why, a commitment, a fact about a person, customer or project — call \`add_memory\` with one self-contained statement. Never save secrets, credentials or one-off chatter.
- If the user says a memory is wrong or outdated, call \`forget_memory\` (or add the corrected fact).
- Use \`graph_paths\` to see how people, companies and products are connected.
`;

async function brainSetup(p: Parsed, client: string | undefined, profile: string, log: (s: string) => void): Promise<number> {
  const creds = await loadCredentials();
  const base = (flag(p, "base-url") ?? process.env.ERA_BASE_URL ?? creds.profiles[profile]?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${base}/api/mcp?tools=brain`;
  const steps: Record<string, { run: string[][]; say: string }> = {
    claude: {
      run: [["claude", "mcp", "add", "--transport", "http", "--scope", "user", "era-brain", url]],
      say: [
        "Claude Code:",
        `  claude mcp add --transport http --scope user era-brain "${url}"`,
        "  then in Claude Code: /mcp → era-brain → Authenticate (Era's consent card opens with Era Brain ticked)",
        "",
        "Or the plugin (the same server + a memory skill that knows when to save and when to recall):",
        "  claude plugin marketplace add geteraio/era-brain-plugin",
        "  claude plugin install era-brain@era",
      ].join("\n"),
    },
    codex: {
      run: [["codex", "mcp", "add", "era-brain", "--url", url], ["codex", "mcp", "login", "era-brain"]],
      say: [
        "Codex:",
        `  codex mcp add era-brain --url "${url}"`,
        "  codex mcp login era-brain        (Era's consent card opens)",
        "",
        "Then add this to AGENTS.md (or ~/.codex/AGENTS.md for every project):",
        "",
        BRAIN_AGENTS_MD,
      ].join("\n"),
    },
  };
  const step = client ? steps[client] : undefined;
  if (!step) {
    process.stdout.write(`Era Brain MCP server: ${url}\n\n${steps.claude!.say}\n\n${steps.codex!.say}`);
    return client ? EXIT.input : 0;
  }
  if (!has(p, "apply")) {
    process.stdout.write(`${step.say}\n\nRun again with --apply and era runs these for you.\n`);
    return 0;
  }
  const { spawnSync } = await import("node:child_process");
  for (const cmd of step.run) {
    log(`$ ${cmd.join(" ")}`);
    const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
    if (r.error || r.status !== 0) throw new CliError(`${cmd[0]} failed${r.error ? `: ${r.error.message}` : ""}. Is ${cmd[0] === "claude" ? "Claude Code" : "Codex"} installed and on your PATH?`, EXIT.failed);
  }
  if (client === "codex") {
    const target = resolve("AGENTS.md");
    const current = existsSync(target) ? await readFile(target, "utf8") : "";
    if (!current.includes("## Memory (Era Brain)")) {
      await writeFile(target, `${current}${current && !current.endsWith("\n") ? "\n\n" : current ? "\n" : ""}${BRAIN_AGENTS_MD}`, "utf8");
      log(`Added the memory instructions to ${target}`);
    }
  }
  log(client === "claude" ? "Done. In Claude Code run /mcp → era-brain → Authenticate." : "Done. Codex now has a memory.");
  return 0;
}


export async function main(argv: readonly string[]): Promise<void> {
  try {
    process.exitCode = await runPublic(argv);
  } catch (e) {
    const err = e instanceof CliError ? e : new CliError(e instanceof Error ? e.message : String(e), EXIT.failed);
    if (parse(argv).flags.has("json")) process.stdout.write(`${JSON.stringify({ error: err.message, exitCode: err.exitCode })}\n`);
    process.stderr.write(`era: ${err.message}\n`);
    process.exitCode = err.exitCode;
  }
}

