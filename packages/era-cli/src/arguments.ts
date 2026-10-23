/**
 * The first words the in-chat door answers. Any other first word (init, deploy, templates, whoami,
 * api, orders …) goes to the public command line (public/commands.ts) with the session's member token.
 */
export const ERA_SESSION_WORDS: readonly string[] = [
  "overview", "records", "message", "document", "meeting", "numbers", "free-times", "site", "file", "open",
  "memory", "brain", "skill", "approvals", "work", "turn", "run", "places", "visuals", "pc", "tools", "find",
  "apps", "app", "media", "decision", "reason", "ontology", "chats", "call",
];

/** True when `era <argv>` is for the in-chat door; false sends it to the public CLI. */
export function isEraSessionCommand(argv: readonly string[]): boolean {
  const first = argv[0];
  return first === undefined || first.startsWith("-") || ERA_SESSION_WORDS.includes(first);
}

export interface EraArguments {
  tool: string;
  args: Record<string, unknown>;
  text: boolean;
  help: boolean;
  jsonInput?: string;
}

/** Self-contained: Station serializes this same parser into its dependency-free Node/Bun entry. */
export function parseArguments(argv: readonly string[]): EraArguments {
  const commands: Record<string, string> = {
    overview: "era_overview", "records find": "records_find", "records create": "records_create",
    "records update": "records_update", "records archive": "records_archive",
    "message send": "message_send", "document create": "document_create", "document issue": "document_issue",
    "meeting schedule": "meeting_schedule", numbers: "business_numbers", "free-times": "free_times",
    "site edit": "site_edit", "site publish": "site_publish", "file save": "file_save",
    "file get": "file_get", "file import": "files_import", open: "era_open",
    "memory save": "memory_save", "memory forget": "memory_forget", "brain search": "brain_search", "brain graph": "brain_graph",
    "skill save": "skill_save", "approvals decide": "approvals_decide", "work status": "work_status",
    "turn report": "turn_report", run: "era_run", "places search": "places_search",
    "visuals make": "visuals_make", "pc act": "pc_act", tools: "tools/list",
    // R15: the app market, media, one search over everything, the brain's deeper tools.
    find: "era_find", "apps find": "apps_find", "app connect": "app_connect", "app run": "app_run", "media make": "media_make",
    "brain path": "brain_path", "brain history": "brain_history", "decision trace": "decision_trace", "decision influence": "decision_influence",
    reason: "reason", "ontology check": "ontology_check", "chats search": "search_past_conversations",
  };
  const fail = (message: string): never => { throw Object.assign(new Error(message), { exitCode: 2 }); };
  const args: Record<string, unknown> = {};
  const words: string[] = [];
  let text = false;
  let help = false;
  let jsonInput: string | undefined;
  const structured = new Set(["facts", "rules", "items", "ids", "where", "to", "lines", "with", "ops", "rows", "columns", "input", "args", "attachments", "refFileIds", "inputFileIds", "mapping", "export"]);
  const numeric = new Set(["limit", "minutes", "count", "width", "height", "depth", "maxNodes"]);
  const boolean = new Set(["draft", "told", "always", "check", "connected"]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === "--text") { text = true; continue; }
    if (raw === "--help" || raw === "-h") { help = true; continue; }
    if (!raw.startsWith("--")) {
      if (raw.startsWith("-")) fail(`Bilinmeyen seçenek: ${raw}`);
      words.push(raw); continue;
    }
    const equal = raw.indexOf("=");
    const name = raw.slice(2, equal < 0 ? undefined : equal).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) fail("Geçersiz alan adı.");
    let value = equal < 0 ? undefined : raw.slice(equal + 1);
    if (value === undefined) {
      const next = argv[i + 1];
      if (boolean.has(name) && (next === undefined || next.startsWith("--"))) value = "true";
      else {
        if (next === undefined || next.startsWith("--")) fail(`--${name} bir değer ister.`);
        value = next; i++;
      }
    }
    if (name === "json") {
      if (jsonInput !== undefined) fail("--json bir kez kullanılabilir.");
      jsonInput = value; continue;
    }
    if (Object.hasOwn(args, name)) fail(`Alan iki kez verildi: ${name}`);
    if (structured.has(name)) {
      try { args[name] = JSON.parse(value!); } catch { fail(`--${name} geçerli JSON ister.`); }
    } else if (numeric.has(name)) {
      if (!/^-?\d+(\.\d+)?$/.test(value!) || !Number.isFinite(Number(value))) fail(`--${name} sayı ister.`);
      args[name] = Number(value);
    } else if (boolean.has(name)) {
      if (value !== "true" && value !== "false") fail(`--${name} true veya false ister.`);
      args[name] = value === "true";
    } else args[name] = value;
  }
  if (!words.length) return { tool: "", args, text, help: true, ...(jsonInput === undefined ? {} : { jsonInput }) };
  // R15: `era call <tool>` reaches any tool the Era MCP lists, even one this CLI does not name yet.
  if (words[0] === "call") {
    if (words.length !== 2 || !/^[a-z][a-z0-9_]*$/.test(words[1]!)) fail("era call <araç_adı> --json '{...}' biçiminde kullanın.");
    return { tool: words[1]!, args, text, help, ...(jsonInput === undefined ? {} : { jsonInput }) };
  }
  const pair = words.slice(0, 2).join(" ");
  const command = commands[pair] ? pair : words[0]!;
  const tool = commands[command];
  if (!tool) fail(`Bilinmeyen komut: ${pair}. era --help ile komutları görün.`);
  const rest = words.slice(command.includes(" ") ? 2 : 1);
  const positional: Record<string, string> = {
    records_find: "type", records_create: "type", records_update: "type", records_archive: "type",
    era_run: "action", era_open: "surface", file_save: "path", file_get: "fileId", files_import: "path",
    brain_search: "query", brain_graph: "query", memory_save: "text", memory_forget: "text", site_edit: "instruction",
    work_status: "jobId", pc_act: "action",
    era_find: "q", apps_find: "q", app_connect: "app", media_make: "prompt", brain_history: "query", search_past_conversations: "query", decision_trace: "decisionId", decision_influence: "decisionId",
  };
  const field = positional[tool!];
  if (rest.length) {
    if (rest.length !== 1 || !field || Object.hasOwn(args, field)) fail("Konumsal değer geçersiz; alanları --alan değer olarak verin.");
    args[field!] = rest[0];
  }
  return { tool: tool!, args, text, help, ...(jsonInput === undefined ? {} : { jsonInput }) };
}
