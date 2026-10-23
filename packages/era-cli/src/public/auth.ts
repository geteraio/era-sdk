import { spawn } from "node:child_process";
import { CLIENT_ID, DEFAULT_BASE_URL, clearProfile, loadCredentials, saveCredentials } from "./config.ts";
import { CliError, EXIT } from "./http.ts";

const UA = "era-cli/0.1 (+https://docs.getera.io/cli)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", '""', url.replace(/&/g, "^&")], { detached: true, stdio: "ignore", windowsVerbatimArguments: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch { /* the URL is printed anyway */ }
}

/**
 * `era login` — OAuth device flow (RFC 8628). The browser shows Era's consent
 * card: pick the workspace, pick what the terminal may reach. The token is
 * bound to that workspace and never reaches further than you can there.
 */
export async function login(opts: { profile: string; baseUrl?: string; scope?: string; noBrowser?: boolean; log: (s: string) => void }): Promise<void> {
  const creds = await loadCredentials();
  const baseUrl = (opts.baseUrl ?? process.env.ERA_BASE_URL ?? creds.profiles[opts.profile]?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const start = await fetch(`${baseUrl}/api/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: opts.scope ?? "* offline_access" }),
  }).catch(() => null);
  if (!start) throw new CliError(`Could not reach ${baseUrl}.`, EXIT.connection);
  const dev = (await start.json().catch(() => ({}))) as {
    device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number; error_description?: string;
  };
  if (!start.ok || !dev.device_code) throw new CliError(`Era refused to start a sign-in: ${dev.error_description ?? start.status}`, EXIT.failed);

  opts.log(`\n  Open ${dev.verification_uri_complete ?? dev.verification_uri}\n  and confirm the code  ${dev.user_code}\n`);
  if (!opts.noBrowser) openBrowser(dev.verification_uri_complete ?? dev.verification_uri!);
  opts.log("  Waiting for you to allow it in the browser…");

  let interval = (dev.interval ?? 5) * 1000;
  const deadline = Date.now() + (dev.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await fetch(`${baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: dev.device_code, client_id: CLIENT_ID }),
    }).catch(() => null);
    if (!res) continue;
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; workspace_id?: string; error?: string; error_description?: string };
    if (res.ok && body.access_token) {
      const c = await loadCredentials();
      c.profiles[opts.profile] = {
        baseUrl,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
        workspaceId: body.workspace_id,
        scope: body.scope,
      };
      c.current = opts.profile;
      await saveCredentials(c);
      return;
    }
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (body.error === "access_denied") throw new CliError("You declined in the browser. Nothing was saved.", EXIT.refused);
    throw new CliError(`Sign-in did not finish: ${body.error_description ?? body.error ?? res.status}`, EXIT.session);
  }
  throw new CliError("The code expired before it was allowed. Run era login again.", EXIT.timeout);
}

/** `era logout` — revokes the token at Era (the whole family) and forgets it here. */
export async function logout(profile: string): Promise<boolean> {
  const c = await loadCredentials();
  const p = c.profiles[profile];
  if (!p) return false;
  for (const token of [p.refreshToken, p.accessToken]) {
    if (!token) continue;
    await fetch(`${p.baseUrl}/api/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ token, client_id: CLIENT_ID }),
    }).catch(() => undefined);
  }
  await clearProfile(profile);
  return true;
}
