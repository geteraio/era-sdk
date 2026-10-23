import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { CliError, EXIT } from "./http.ts";

/**
 * `era images generate` — pictures made with the person's own ChatGPT plan, through the Codex CLI's
 * built-in image tool (R54 G17). No paid image API: Codex runs headless (`codex exec`), with every
 * OpenAI/Codex API-key variable removed from its environment, so the only way it can draw is the
 * signed-in ChatGPT account. A Codex signed in with an API key is refused (that would bill per image).
 *
 * Codex writes what its image tool makes to $CODEX_HOME/generated_images/<thread id>/; we read the
 * thread id from `codex exec --json`, copy the files out, and (when an encoder is on the machine:
 * sharp, or Python with Pillow) crop to the asked shape and save WebP/AVIF at web size. Without an
 * encoder the PNG is kept and we say so; Era's own image door (/api/site/img) serves WebP anyway.
 */

export const IMAGES_HELP = `era images — pictures made with your own ChatGPT plan (through the Codex CLI), no paid image API

  era images generate --prompt "<what to show>" --out <file|folder>
      [--style "<one art-direction line, the same for every picture of this brand>"]
      [--size square|landscape|portrait|wide|4:5|1600x1000]   shape (default square)
      [--count 1-4] [--format webp|avif|png|jpg] [--max-width 1600] [--quality 82]
      [--ref <image>]…       keep the look of an earlier picture (same bag, same table, same light)
      [--model <codex model>] [--timeout 600] [--json]
  era images status          is Codex installed and signed in with ChatGPT?

Needs the Codex CLI signed in with ChatGPT (codex login → "Sign in with ChatGPT"). Every picture
is a new image: no real brands' logos, no faces that could pass for real staff.
`;

type Flags = { get(name: string): string | undefined; all(name: string): string[]; has(name: string): boolean };

const API_KEY_VARS = ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"];

const SHAPES: Record<string, { ratio: number; words: string }> = {
  square: { ratio: 1, words: "square 1:1" },
  landscape: { ratio: 3 / 2, words: "landscape 3:2" },
  portrait: { ratio: 2 / 3, words: "portrait 2:3" },
  wide: { ratio: 16 / 9, words: "wide landscape 16:9" },
};

interface Shape { ratio: number; words: string; width?: number }

function shapeOf(raw: string | undefined): Shape {
  const s = (raw ?? "square").trim().toLowerCase();
  if (SHAPES[s]) return SHAPES[s]!;
  const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s);
  if (ratio) {
    const r = Number(ratio[1]) / Number(ratio[2]);
    if (r > 0.25 && r < 4) return { ratio: r, words: `${r >= 1 ? "landscape" : "portrait"} ${s}` };
  }
  const px = /^(\d{2,5})x(\d{2,5})$/.exec(s);
  if (px) {
    const w = Number(px[1]), h = Number(px[2]);
    const r = w / h;
    if (r > 0.25 && r < 4) return { ratio: r, width: w, words: `${r > 1.05 ? "landscape" : r < 0.95 ? "portrait" : "square"} ${w}:${h}` };
  }
  throw new CliError(`--size: square, landscape, portrait, wide, a ratio like 4:5, or WxH like 1600x1000 (got "${raw}").`, EXIT.input);
}

/** The environment Codex runs in: the person's own, minus every API-key door. */
function codexEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (API_KEY_VARS.includes(k.toUpperCase())) delete env[k];
  return env;
}

interface Run { code: number; out: string; err: string; timedOut: boolean }

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<Run> {
  return new Promise((done) => {
    let child: ChildProcessWithoutNullStreams;
    const win = process.platform === "win32";
    const q = (a: string) => (win && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    try {
      // Windows: `codex` / `npx` are .cmd/.exe shims found through PATHEXT, so go through the shell; every
      // argument with a space is quoted, and the prompt itself travels on stdin.
      child = spawn(q(cmd), args.map(q), { cwd: opts.cwd, env: opts.env ?? process.env, shell: win, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      done({ code: -1, out: "", err: e instanceof Error ? e.message : String(e), timedOut: false });
      return;
    }
    let out = "", err = "", timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, opts.timeoutMs) : undefined;
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e: Error) => { err += e.message; });
    child.on("close", (code: number | null) => { if (timer) clearTimeout(timer); done({ code: code ?? -1, out, err, timedOut }); });
    child.stdin.end(opts.input ?? "");
  });
}

/** Which Codex to run: ERA_CODEX_BIN, the one on PATH, else the pinned npm package. */
async function findCodex(): Promise<{ cmd: string; pre: string[] } | null> {
  const own = process.env.ERA_CODEX_BIN?.trim();
  const candidates: { cmd: string; pre: string[] }[] = [
    ...(own ? [{ cmd: own, pre: [] }] : []),
    { cmd: "codex", pre: [] },
    { cmd: "npx", pre: ["-y", "@openai/codex@0.161.0"] },
  ];
  for (const c of candidates) {
    const r = await run(c.cmd, [...c.pre, "--version"], { timeoutMs: 120_000, env: codexEnv() });
    if (r.code === 0 && /codex/i.test(r.out + r.err)) return c;
  }
  return null;
}

type Login = "chatgpt" | "api-key" | "none" | "unknown";

async function loginOf(codex: { cmd: string; pre: string[] }): Promise<{ state: Login; text: string }> {
  const r = await run(codex.cmd, [...codex.pre, "login", "status"], { timeoutMs: 60_000, env: codexEnv() });
  const text = `${r.out}\n${r.err}`.trim();
  if (/chatgpt/i.test(text) && /logged in/i.test(text)) return { state: "chatgpt", text };
  if (/api key/i.test(text) && /logged in/i.test(text)) return { state: "api-key", text };
  if (/not logged in/i.test(text)) return { state: "none", text };
  return { state: "unknown", text };
}

const NOT_SIGNED_IN =
  "Codex is not signed in with ChatGPT, so it cannot make pictures on your plan. Run `codex login` and choose \"Sign in with ChatGPT\" (one time), then try again. Until then use your own photos or Era's photo library.";

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

const RASTER = /\.(png|jpe?g|webp)$/i;

async function imagesIn(dir: string, since: number): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const rows: { path: string; t: number }[] = [];
  for (const n of names) {
    if (!RASTER.test(n)) continue;
    const st = await stat(join(dir, n)).catch(() => null);
    if (st?.isFile() && st.mtimeMs >= since - 2000) rows.push({ path: join(dir, n), t: st.mtimeMs });
  }
  return rows.sort((a, b) => a.t - b.t).map((r) => r.path);
}

function briefFor(prompt: string, style: string | undefined, shape: Shape, count: number, refs: number): string {
  return [
    `Use your built-in image generation tool to create exactly ${count} image${count > 1 ? "s" : ""}${count > 1 ? " (variations of the same brief, each a separate image)" : ""}.`,
    "Do not run shell commands, do not write or run scripts, do not call any API or the image_gen.py CLI: only the built-in image tool.",
    refs ? `The attached image${refs > 1 ? "s are" : " is"} the visual reference: keep the same art direction, light, materials, packaging design and colour grade.` : "",
    style ? `Art direction (the same for every picture of this brand): ${style}` : "",
    `Subject: ${prompt}`,
    `Shape: ${shape.words}. Full-bleed photograph, no borders, no frames, no watermark, no captions or text overlays except text printed on the product itself when the subject names it.`,
    "Rules: never show a real company's logo or trademark; no recognisable faces (if people appear they are anonymous: hands, backs, out of focus); nothing that could pass for real staff or a real customer.",
    "When the image tool has finished, reply with only the word DONE.",
  ].filter(Boolean).join("\n");
}

// ── encoding (optional): sharp, else Python + Pillow, else keep the PNG ───────────────────────────

type Encoded = { path: string; width: number; height: number; format: string; bytes: number; note?: string };

async function trySharp(): Promise<any | null> {
  for (const from of [import.meta.url, join(process.cwd(), "noop.js")]) {
    try {
      const req = createRequire(from);
      const mod = req("sharp");
      return mod?.default ?? mod;
    } catch { /* next */ }
  }
  return null;
}

const PIL_SCRIPT = `
import sys, json
from PIL import Image
src, dst, fmt, ratio, maxw, q = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
im = Image.open(src); im.load()
if im.mode not in ("RGB", "RGBA"): im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
w, h = im.size
if ratio > 0:
    if w / h > ratio:
        nw = int(round(h * ratio)); x = (w - nw) // 2; im = im.crop((x, 0, x + nw, h))
    elif w / h < ratio:
        nh = int(round(w / ratio)); y = (h - nh) // 2; im = im.crop((0, y, w, y + nh))
w, h = im.size
if maxw > 0 and w > maxw:
    im = im.resize((maxw, int(round(h * maxw / w))), Image.LANCZOS)
if fmt in ("jpeg",) and im.mode == "RGBA": im = im.convert("RGB")
kw = {"quality": q}
if fmt == "webp": kw["method"] = 6
if fmt == "png": kw = {"optimize": True}
im.save(dst, fmt.upper(), **kw)
print(json.dumps({"width": im.size[0], "height": im.size[1]}))
`;

async function encode(src: string, dst: string, format: string, shape: Shape, maxWidth: number, quality: number): Promise<Encoded> {
  const fmt = format === "jpg" ? "jpeg" : format;
  const sharp = await trySharp();
  if (sharp) {
    try {
      const img = sharp(src).rotate();
      const meta = await sharp(src).metadata();
      let w = meta.width ?? 0, h = meta.height ?? 0;
      let left = 0, top = 0, cw = w, ch = h;
      if (w / h > shape.ratio) { cw = Math.round(h * shape.ratio); left = Math.floor((w - cw) / 2); }
      else if (w / h < shape.ratio) { ch = Math.round(w / shape.ratio); top = Math.floor((h - ch) / 2); }
      let p = img.extract({ left, top, width: cw, height: ch });
      if (cw > maxWidth) p = p.resize({ width: maxWidth });
      p = fmt === "webp" ? p.webp({ quality, effort: 6 }) : fmt === "avif" ? p.avif({ quality: Math.max(30, quality - 25) }) : fmt === "jpeg" ? p.jpeg({ quality, mozjpeg: true }) : p.png({ compressionLevel: 9 });
      const info = await p.toFile(dst);
      w = info.width; h = info.height;
      return { path: dst, width: w, height: h, format: fmt, bytes: (await stat(dst)).size };
    } catch { /* fall through to Python */ }
  }
  const script = join(dirname(dst), `.era-encode-${process.pid}.py`);
  await writeFile(script, PIL_SCRIPT);
  try {
    for (const py of process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"]) {
      const r = await run(py, [script, src, dst, fmt, String(shape.ratio), String(maxWidth), String(fmt === "avif" ? Math.max(30, quality - 25) : quality)], { timeoutMs: 120_000 });
      if (r.code === 0) {
        try {
          const dims = JSON.parse(r.out.trim().split("\n").pop() ?? "{}") as { width: number; height: number };
          return { path: dst, width: dims.width, height: dims.height, format: fmt, bytes: (await stat(dst)).size };
        } catch { /* odd output: treat as failed */ }
      }
    }
  } finally {
    await rm(script, { force: true }).catch(() => undefined);
  }
  // No encoder here: keep Codex's PNG as it is.
  const png = dst.replace(/\.[a-z0-9]+$/i, ".png");
  await copyFile(src, png);
  return { path: png, width: 0, height: 0, format: "png", bytes: (await stat(png)).size, note: `kept as PNG: no WebP/AVIF encoder on this machine (sharp, or Python with Pillow). Era serves it as WebP through its image door.` };
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

export async function imagesCommand(rest: string[], f: Flags, log: (s: string) => void, print: (value: unknown, human: () => string) => void): Promise<number> {
  const sub = rest[0];
  if (!sub || sub === "help" || f.has("help")) { process.stdout.write(IMAGES_HELP); return 0; }

  if (sub === "status") {
    const codex = await findCodex();
    if (!codex) {
      print({ codex: false, signedIn: false }, () => "Codex CLI is not installed. npm i -g @openai/codex, then codex login (Sign in with ChatGPT).");
      return EXIT.session;
    }
    const login = await loginOf(codex);
    print({ codex: true, via: [codex.cmd, ...codex.pre].join(" "), login: login.state }, () =>
      login.state === "chatgpt" ? "Codex is signed in with ChatGPT: era images generate works on your plan." :
      login.state === "api-key" ? "Codex is signed in with an API key, which bills per image. Run codex login and choose Sign in with ChatGPT." : NOT_SIGNED_IN);
    return login.state === "chatgpt" ? 0 : EXIT.session;
  }

  if (sub !== "generate") throw new CliError(`era images generate|status (got "${sub}"). era images help`, EXIT.input);

  const prompt = (f.get("prompt") ?? rest.slice(1).join(" ")).trim();
  if (!prompt) throw new CliError("Say what to show: --prompt \"…\".", EXIT.input);
  if (prompt.length > 4000) throw new CliError("--prompt is too long (4000 characters at most).", EXIT.input);
  const outRaw = f.get("out");
  if (!outRaw) throw new CliError("Where to save it: --out <file.webp> or --out <folder>.", EXIT.input);
  const count = Number(f.get("count") ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new CliError("--count is 1 to 4.", EXIT.input);
  const shape = shapeOf(f.get("size"));
  const out = resolve(outRaw);
  const outExt = extname(out).slice(1).toLowerCase();
  const isFile = /^(webp|avif|png|jpe?g)$/.test(outExt);
  const format = (f.get("format") ?? (isFile ? outExt : "webp")).toLowerCase().replace("jpeg", "jpg");
  if (!["webp", "avif", "png", "jpg"].includes(format)) throw new CliError("--format is webp, avif, png or jpg.", EXIT.input);
  const maxWidth = Number(f.get("max-width") ?? shape.width ?? 1600);
  const quality = Number(f.get("quality") ?? 82);
  if (!Number.isFinite(maxWidth) || maxWidth < 64 || maxWidth > 4096) throw new CliError("--max-width is 64–4096.", EXIT.input);
  if (!Number.isFinite(quality) || quality < 30 || quality > 100) throw new CliError("--quality is 30–100.", EXIT.input);
  const refs = f.all("ref").map((r) => resolve(r));
  for (const r of refs) if (!existsSync(r)) throw new CliError(`--ref ${r}: no such file.`, EXIT.input);
  const timeoutMs = Math.max(60, Math.min(1800, Number(f.get("timeout") ?? 600))) * 1000;

  const codex = await findCodex();
  if (!codex) throw new CliError("The Codex CLI is not installed here. Install it (npm i -g @openai/codex), run codex login → Sign in with ChatGPT, then try again.", EXIT.session);
  const login = await loginOf(codex);
  if (login.state === "api-key") throw new CliError("Codex is signed in with an API key, which bills per image. Run codex login and choose \"Sign in with ChatGPT\" so pictures come from your plan.", EXIT.refused);
  if (login.state !== "chatgpt") throw new CliError(NOT_SIGNED_IN, EXIT.session);

  const work = await mkdtemp(join(tmpdir(), "era-images-"));
  const started = Date.now();
  try {
    const args = [
      ...codex.pre, "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", work,
      "-c", "model_reasoning_effort=low",
      ...(f.get("model") ? ["-m", f.get("model")!] : []),
      ...refs.flatMap((r) => ["-i", r]),
      "-",
    ];
    log(`Making ${count} picture${count > 1 ? "s" : ""} with Codex on your ChatGPT plan (about a minute each)…`);
    const r = await run(codex.cmd, args, { cwd: work, input: briefFor(prompt, f.get("style"), shape, count, refs.length), timeoutMs, env: codexEnv() });
    const events = r.out.split("\n").map((l) => { try { return JSON.parse(l) as Record<string, any>; } catch { return null; } }).filter(Boolean) as Record<string, any>[];
    const thread = events.find((e) => e.type === "thread.started")?.thread_id as string | undefined;
    const said = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => String(e.item.text)).at(-1) ?? "";
    const failure = events.find((e) => e.type === "turn.failed" || e.type === "error");
    if (r.timedOut) throw new CliError(`Codex did not finish within ${timeoutMs / 1000} s.`, EXIT.timeout);

    const found = thread ? await imagesIn(join(codexHome(), "generated_images", thread), started) : [];
    if (!found.length) {
      const why = failure ? JSON.stringify(failure.error ?? failure.message ?? failure).slice(0, 300) : said || r.err.split("\n").filter((l) => /error/i.test(l)).slice(-2).join(" ").slice(0, 300);
      if (/usage limit|rate limit|quota/i.test(why)) throw new CliError(`Your ChatGPT plan's image limit is reached for now (${why}). Try again later.`, EXIT.refused);
      if (/log ?in|auth|unauthori[sz]ed|401/i.test(why)) throw new CliError(NOT_SIGNED_IN, EXIT.session);
      throw new CliError(`Codex made no picture${why ? `: ${why}` : ""}.`, EXIT.failed);
    }

    const picked = found.slice(-count);
    const targets: string[] = [];
    if (isFile) {
      await mkdir(dirname(out), { recursive: true });
      const stem = out.slice(0, -extname(out).length);
      picked.forEach((_, i) => targets.push(`${picked.length === 1 ? stem : `${stem}-${i + 1}`}.${format}`));
    } else {
      await mkdir(out, { recursive: true });
      const slug = prompt.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
      picked.forEach((_, i) => targets.push(join(out, `${slug}${picked.length === 1 ? "" : `-${i + 1}`}.${format}`)));
    }
    const files: Encoded[] = [];
    for (let i = 0; i < picked.length; i++) files.push(await encode(picked[i]!, targets[i]!, format, shape, maxWidth, quality));
    const seconds = Math.round((Date.now() - started) / 1000);
    print({ files, seconds, via: "codex (ChatGPT plan)" }, () =>
      files.map((x) => `${x.path}  ${x.width ? `${x.width}×${x.height} ` : ""}${x.format} ${Math.round(x.bytes / 1024)} KB${x.note ? `  (${x.note})` : ""}`).join("\n") + `\n${files.length} picture${files.length > 1 ? "s" : ""} in ${seconds} s.`);
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const _test = { shapeOf, briefFor };
