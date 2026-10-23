import { ERA_SESSION_WORDS, parseArguments, type EraArguments } from "./arguments.ts";

/** No module closures: the exact checked implementation is embedded in Station's generated .mjs. */
export async function runEraCli(parse: (argv: readonly string[]) => EraArguments): Promise<void> {
  const help = "Era komutları:\n  overview; records find|create|update|archive; message send; document create|issue\n  meeting schedule; numbers; free-times; site edit|publish; file save|get|import\n  open; memory save|forget; brain search; skill save; approvals decide; work status\n  turn report; run; places search; visuals make; pc act; tools\n  find; apps find; app connect|run; media make; brain graph|path|history\n  decision trace|influence; reason; ontology check; chats search; call <araç>\n\nGiriş: --alan değer, --json '{...}', --json @dosya.json veya --json - (stdin).\nDiziler: records create|update, approvals decide ve run için items; archive için ids.\nÇıkış: kısa JSON; --text okunabilir metin. era tools güncel izinli şemaları verir.\nÖrnek: era records create customer --json @musteriler.json\nKodlar: 0 başarılı, 2 giriş, 3 oturum, 4 izin/onay reddi, 5 işlem/kısmi hata, 6 bağlantı, 7 zaman aşımı.\n\nSite ve uygulama kurmak (Era API, bu kişinin kendi izinleriyle):\n  templates; init --template <ad>; dev; build; deploy [--site <id>] [--provider local]; domains\n  whoami; resources; actions [<modül>]; api GET /api/v1/...; <kaynak> list|get|create (ör. era orders list --json)\n  Tam liste: era whoami --help\n";
  let textMode = false;
  const emit = (body: unknown) => {
    process.stdout.write((textMode ? (typeof body === "string" ? body : JSON.stringify(body, null, 2)) : JSON.stringify(body)) + "\n");
  };
  const fail = (message: string, exitCode: number): never => { throw Object.assign(new Error(message), { exitCode }); };
  try {
    const command = parse(process.argv.slice(2));
    textMode = command.text;
    if (command.help) { process.stdout.write(help); return; }
    const args = { ...command.args };
    if (command.jsonInput !== undefined) {
      const { readFile } = await import("node:fs/promises");
      let input = command.jsonInput;
      if (input === "-") {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        input = Buffer.concat(chunks).toString("utf8");
      } else if (input.startsWith("@")) {
        try { input = await readFile(input.slice(1), "utf8"); } catch { fail("JSON dosyası okunamadı.", 2); }
      }
      let value: unknown;
      try { value = JSON.parse(input); } catch { fail("Giriş geçerli JSON değil.", 2); }
      if (Array.isArray(value)) {
        const key = command.tool === "records_archive" ? "ids" : "items";
        if (!["records_create", "records_update", "records_archive", "approvals_decide", "era_run"].includes(command.tool)) fail("Bu komut JSON nesnesi ister.", 2);
        value = { [key]: value };
      }
      if (!value || typeof value !== "object") fail("Giriş JSON nesnesi olmalı.", 2);
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(args, key)) fail(`Geçersiz veya tekrarlı alan: ${key}`, 2);
        args[key] = val;
      }
    }
    const url = process.env.ERA_CLI_URL;
    const token = process.env.ERA_CLI_TOKEN;
    if (!url || !token) fail("Era oturumu bulunamadı. Komutu Era sohbetinin terminalinde çalıştırın.", 3);
    let endpoint: URL;
    try { endpoint = new URL(url!); } catch { fail("Era oturum adresi geçersiz.", 3); }
    // Station only supplies a thread-scoped loopback key. Never forward it to a remote URL or redirect.
    if (endpoint!.protocol !== "http:" || endpoint!.hostname !== "127.0.0.1" || endpoint!.pathname !== "/era/mcp" || endpoint!.username || endpoint!.password || endpoint!.search || endpoint!.hash) fail("Era oturum kapısı geçersiz.", 3);
    const call = async (tool: string, input: Record<string, unknown>): Promise<{ body: unknown; error: boolean }> => {
      let response: Response;
      try {
        response = await fetch(endpoint!, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(660_000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: tool === "tools/list" ? tool : "tools/call", ...(tool === "tools/list" ? {} : { params: { name: tool, arguments: input } }) }),
        });
      } catch (error) { fail(error instanceof Error && error.name === "TimeoutError" ? "Era yanıtı zaman aşımına uğradı; işlem sonucunu kontrol edin." : "Era bağlantısı kesildi; yazmayı tekrarlamadan işlem sonucunu kontrol edin.", error instanceof Error && error.name === "TimeoutError" ? 7 : 6); }
      if (!response!.ok) fail(response!.status === 401 ? "Era oturumu sona erdi." : response!.status === 403 ? "Bu işlem için izin yok." : `Era kapısı yanıt vermedi (${response!.status}).`, response!.status === 401 ? 3 : response!.status === 403 ? 4 : 6);
      const raw = await response!.text();
      let rpc: { id?: unknown; result?: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }; error?: { message?: string } } | undefined;
      try {
        if ((response!.headers.get("content-type") ?? "").includes("text/event-stream")) {
          for (const event of raw.replace(/\r\n/g, "\n").split("\n\n")) {
            const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            const message = JSON.parse(data) as typeof rpc;
            if (message?.id === 1) rpc = message;
          }
        } else rpc = JSON.parse(raw) as typeof rpc;
      } catch { fail("Era yanıtı okunamadı; yazmayı tekrarlamadan işlem sonucunu kontrol edin.", 6); }
      if (!rpc || rpc.id !== 1 || (!rpc.result && !rpc.error)) fail("Era geçerli işlem sonucu döndürmedi.", 6);
      if (rpc!.error) return { body: { error: rpc!.error.message ?? "İşlem reddedildi." }, error: true };
      const result = rpc!.result!;
      if (tool === "tools/list") return { body: result, error: false };
      let body: unknown = result.structuredContent;
      if (body === undefined) {
        const content = result.content ?? [];
        if (content.length === 1 && content[0]?.type === "text") {
          const value = content[0].text ?? "";
          try { body = JSON.parse(value); } catch { body = { text: value }; }
        } else body = { content };
      }
      return { body, error: result.isError === true };
    };
    // A local import first saves the actual file through the existing loopback Files handling.
    if (command.tool === "file_save" || command.tool === "files_import") {
      if (typeof args.path === "string") {
        const { resolve } = await import("node:path");
        args.path = resolve(args.path);
      }
    }
    if (command.tool === "files_import" && typeof args.path === "string") {
      if (args.fileId || args.file) fail("Import için path, fileId veya file seçeneklerinden birini verin.", 2);
      const saved = await call("file_save", { path: args.path });
      const savedBody = saved.body as { fileId?: string };
      if (saved.error || !savedBody?.fileId) { emit(saved.body); process.exitCode = 5; return; }
      delete args.path;
      args.fileId = savedBody.fileId;
    }
    const answer = await call(command.tool, args);
    emit(answer.body);
    const body = answer.body as { status?: string; failed?: number; ok?: boolean; error?: unknown; success?: boolean } | null;
    process.exitCode = body && ["declined", "denied", "rejected", "rejected_before"].includes(body.status ?? "") ? 4
      : answer.error || (body && (body.ok === false || body.success === false || body.error || (typeof body.failed === "number" && body.failed > 0) || ["partial", "failed"].includes(body.status ?? ""))) ? 5 : 0;
  } catch (error) {
    const known = error as { message?: string; exitCode?: number };
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    emit({ error: known.exitCode ? known.message : timedOut ? "Era yanıtı zaman aşımına uğradı; işlem sonucunu kontrol edin." : "Era komutu tamamlanamadı; işlem sonucunu kontrol edin." });
    process.exitCode = known.exitCode ?? (timedOut ? 7 : 6);
  }
}

/**
 * Like Station's stdio proxy: materialize one portable script, containing no credentials or repo paths.
 * The in-chat words run here; every other first word (init, deploy, whoami, orders …) loads the public
 * CLI written beside it (`era-public.mjs`, ERA_PUBLIC_CLI_JS), which reads ERA_BASE_URL + ERA_TOKEN.
 */
export function renderEraCliExecutable(): string {
  return `#!/usr/bin/env node\n// Era writes this file. No credentials are stored here.\nconst sessionWords = ${JSON.stringify(ERA_SESSION_WORDS)};\nconst first = process.argv[2];\nif (first !== undefined && !first.startsWith("-") && !sessionWords.includes(first)) {\n  await import(new URL("./era-public.mjs", import.meta.url).href);\n} else {\n  await (${runEraCli.toString()})(${parseArguments.toString()});\n}\n`;
}
