import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where `era login` keeps its sign-in: one file in the user's config folder,
 * readable only by them (0600). Never inside a project folder, never printed.
 * ERA_API_KEY / ERA_TOKEN in the environment win over the file (CI, scripts).
 */

export interface Profile {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt?: number;
  workspaceId?: string;
  scope?: string;
}

export interface Credentials {
  current: string;
  profiles: Record<string, Profile>;
}

export const DEFAULT_BASE_URL = "https://app.getera.io";
export const CLIENT_ID = "era-cli";

export function configDir(): string {
  if (process.env.ERA_CONFIG_DIR) return process.env.ERA_CONFIG_DIR;
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "era");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "era");
}

const file = () => join(configDir(), "credentials.json");

export async function loadCredentials(): Promise<Credentials> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8")) as Credentials;
    if (parsed && typeof parsed === "object" && parsed.profiles) return parsed;
  } catch { /* none yet */ }
  return { current: "default", profiles: {} };
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await mkdir(dirname(file()), { recursive: true });
  await writeFile(file(), `${JSON.stringify(c, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(file(), 0o600).catch(() => undefined);
}

export async function clearProfile(name: string): Promise<void> {
  const c = await loadCredentials();
  delete c.profiles[name];
  if (Object.keys(c.profiles).length === 0) await rm(file(), { force: true });
  else await saveCredentials(c);
}

export function profileName(flag?: string): string {
  return flag ?? process.env.ERA_PROFILE ?? "default";
}
