#!/usr/bin/env node
/**
 * The public command line alone (no in-chat door): `era-public.mjs`, which an Era chat's terminal
 * reaches through its `era` command for the verbs the chat door does not have (init, dev, build,
 * deploy, templates, whoami, api, <resource> list …). Station writes it beside `era.mjs`.
 */
import { main } from "./commands.ts";

await main(process.argv.slice(2));
