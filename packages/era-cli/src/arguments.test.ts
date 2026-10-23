import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArguments } from "./arguments.ts";

test("all 28 named tool commands map to the existing surface", () => {
  const commands = [
    ["overview", "era_overview"], ["records find", "records_find"], ["records create", "records_create"],
    ["records update", "records_update"], ["records archive", "records_archive"], ["message send", "message_send"],
    ["document create", "document_create"], ["document issue", "document_issue"], ["meeting schedule", "meeting_schedule"],
    ["numbers", "business_numbers"], ["free-times", "free_times"], ["site edit", "site_edit"],
    ["site publish", "site_publish"], ["file save", "file_save"], ["file get", "file_get"],
    ["file import", "files_import"], ["open", "era_open"], ["memory save", "memory_save"],
    ["memory forget", "memory_forget"], ["brain search", "brain_search"], ["skill save", "skill_save"],
    ["approvals decide", "approvals_decide"], ["work status", "work_status"], ["turn report", "turn_report"],
    ["run", "era_run"], ["places search", "places_search"], ["visuals make", "visuals_make"], ["pc act", "pc_act"],
  ];
  for (const [command, tool] of commands) assert.equal(parseArguments(command!.split(" ")).tool, tool);
});
test("flat fields, structured values, booleans and numbers keep their types", () => {
  assert.deepEqual(parseArguments(["records", "find", "customer", "--q", "00123", "--limit=5", "--where", '{"active":true}', "--text"]).args,
    { type: "customer", q: "00123", limit: 5, where: { active: true } });
  assert.deepEqual(parseArguments(["message", "send", "--draft", "--to", '{"conversationId":"id"}', "--text"]).args,
    { draft: true, to: { conversationId: "id" } });
  assert.equal(parseArguments(["memory", "save", "Bir tercih", "--told=false"]).args.told, false);
  assert.equal(parseArguments(["document", "create", "--customer-id", "007"]).args.customerId, "007");
  assert.equal(parseArguments(["message", "send", "--text=Merhaba"]).args.text, "Merhaba");
});
test("literal, file and stdin JSON remain opaque until the I/O layer", () => {
  for (const input of ['[{"name":"Ayşe"}]', "@bulk.json", "-"]) {
    const args = parseArguments(["records", "create", "customer", "--json", input]);
    assert.equal(args.jsonInput, input);
    assert.equal(args.args.type, "customer");
  }
});
test("long-tail and file/surface positional shortcuts", () => {
  assert.equal(parseArguments(["run", "workflows.draft"]).args.action, "workflows.draft");
  assert.equal(parseArguments(["file", "import", "C:\\My Files\\rows.xlsx"]).args.path, "C:\\My Files\\rows.xlsx");
  assert.equal(parseArguments(["open", "record", "--id", "001"]).args.surface, "record");
  assert.equal(parseArguments(["tools"]).tool, "tools/list");
});
test("ambiguous or malformed arguments fail before an HTTP call", () => {
  for (const argv of [
    ["unknown"], ["records", "create", "--type"], ["records", "find", "--limit", "NaN"],
    ["records", "create", "--items", "{"], ["message", "send", "--draft=maybe"],
    ["records", "find", "customer", "--type", "lead"], ["run", "a", "b"],
    ["overview", "--constructor", "x"], ["overview", "--json", "{}", "--json", "{}"],
    ["overview", "--q", "a", "--q", "b"], ["overview", "-x"],
  ]) assert.throws(() => parseArguments(argv), (error: unknown) => (error as { exitCode?: number }).exitCode === 2);
});
test("help and human output do not need a session", () => {
  assert.equal(parseArguments([]).help, true);
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["overview", "--text"]).text, true);
});
