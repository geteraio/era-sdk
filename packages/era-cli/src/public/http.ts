import { CLIENT_ID, DEFAULT_BASE_URL, loadCredentials, saveCredentials, type Profile } from "./config.ts";

/** Exit codes, the same vocabulary as Era's in-chat terminal command. */
export const EXIT = { ok: 0, input: 2, session: 3, refused: 4, failed: 5, connection: 6, timeout: 7 } as const;

export class CliError extends Error {
  constructor(message: string, readonly exitCode: number, readonly body?: unknown) {
    super(message);
  }
}

export interface Session {
  baseUrl: string;
  /** Returns a valid bearer, refreshing a login token when it is about to expire. */
  bearer(): Promise<string>;
  source: "env-key" | "env-token" | "login";
}

const UA = "era-cli/0.1 (+https://docs.getera.io/cli)";

export async function openSession(profile: string, baseUrlFlag?: string): Promise<Session> {
  const envBase = process.env.ERA_BASE_URL;
  if (process.env.ERA_API_KEY) {
    const key = process.env.ERA_API_KEY;
    return { baseUrl: (baseUrlFlag ?? envBase ?? DEFAULT_BASE_URL).replace(/\/$/, ""), bearer: async () => key, source: "env-key" };
  }
  if (process.env.ERA_TOKEN) {
    const token = process.env.ERA_TOKEN;
    return { baseUrl: (baseUrlFlag ?? envBase ?? DEFAULT_BASE_URL).replace(/\/$/, ""), bearer: async () => token, source: "env-token" };
  }
  const creds = await loadCredentials();
  const p = creds.profiles[profile];
  if (!p?.accessToken) throw new CliError("You are not signed in. Run: era login", EXIT.session);
  const baseUrl = (baseUrlFlag ?? p.baseUrl).replace(/\/$/, "");
  return {
    baseUrl,
    source: "login",
    bearer: async () => {
      if (p.expiresAt && p.expiresAt - Date.now() < 60_000 && p.refreshToken) await refresh(profile, p);
      return p.accessToken!;
    },
  };
}

async function refresh(profile: string, p: Profile): Promise<void> {
  const res = await fetch(`${p.baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: p.refreshToken!, client_id: CLIENT_ID }),
  }).catch(() => null);
  if (!res) throw new CliError("Could not reach Era to renew your sign-in.", EXIT.connection);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new CliError(`Your sign-in has ended (${body.error_description ?? res.status}). Run: era login`, EXIT.session);
  p.accessToken = body.access_token;
  p.refreshToken = body.refresh_token ?? p.refreshToken;
  p.expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
  const creds = await loadCredentials();
  creds.profiles[profile] = p;
  await saveCredentials(creds);
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; status?: number; problems?: { field: string; message: string }[]; request_id?: string };
}

/** One call to the Era API. Throws CliError with a readable message and the right exit code. */
export async function api<T = unknown>(
  s: Session,
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const url = new URL(`${s.baseUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await s.bearer()}`,
        accept: "application/json",
        "user-agent": UA,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new CliError(timeout ? "Era did not answer in time; check the result before retrying a write." : `Could not reach ${s.baseUrl}.`, timeout ? EXIT.timeout : EXIT.connection);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    const problems = err?.problems?.length ? `\n${err.problems.map((p) => `  · ${p.field}: ${p.message}`).join("\n")}` : "";
    const message = `${err?.message ?? `HTTP ${res.status}`}${err?.code ? ` (${err.code})` : ""}${problems}`;
    const code = res.status === 401 ? EXIT.session : res.status === 403 || res.status === 404 || res.status === 409 ? EXIT.refused : res.status === 400 || res.status === 422 ? EXIT.input : EXIT.failed;
    throw new CliError(message, code, json);
  }
  return json as T;
}
