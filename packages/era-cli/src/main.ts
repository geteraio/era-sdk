#!/usr/bin/env node
/**
 * `era` — two doors, one binary:
 *   · inside an Era chat (ERA_CLI_URL + ERA_CLI_TOKEN set by Era Station): the
 *     thread-scoped in-session command (runtime.ts, unchanged);
 *   · everywhere else: the public command line over the Era API — era login,
 *     era orders list, era deploy … (public/commands.ts).
 */
import { isEraSessionCommand, parseArguments } from "./arguments.ts";
import { runEraCli } from "./runtime.ts";
import { main } from "./public/commands.ts";

const first = process.argv[2];
if (first === "--version" || first === "-v" || first === "version") {
  // dist/era.mjs and src/main.ts both sit one folder below the package's own package.json.
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

// In a chat, only the chat door's own words stay there; init, deploy, whoami, orders … are the public CLI.
if (process.env.ERA_CLI_URL && process.env.ERA_CLI_TOKEN && isEraSessionCommand(process.argv.slice(2))) await runEraCli(parseArguments);
else await main(process.argv.slice(2));
