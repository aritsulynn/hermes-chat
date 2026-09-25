import assert from "node:assert/strict";
import test from "node:test";

import * as api from "./api.ts";

// These assertions pin each builder to the exact string literal that used to be
// inlined at its call site. If a refactor changes a route or a query string,
// this fails instead of silently hitting a 404 against a live dashboard.

test("auth and status routes", () => {
  assert.equal(api.status(), "/api/status");
  assert.equal(api.passwordLogin(), "/auth/password-login");
  assert.equal(api.logout(), "/auth/logout");
  assert.equal(api.wsTicket(), "/api/auth/ws-ticket");
  assert.equal(api.authMe(), "/api/auth/me");
  assert.equal(api.ws("tk_123"), "/api/ws?ticket=tk_123");
  assert.equal(api.ws("a/b+c"), "/api/ws?ticket=a%2Fb%2Bc");
});

test("profile routes", () => {
  assert.equal(api.profiles(), "/api/profiles");
  assert.equal(api.activeProfile(), "/api/profiles/active");
});

test("model option query flags are omitted when unset", () => {
  assert.equal(api.modelOptions(), "/api/model/options");
  assert.equal(
    api.modelOptions({ refresh: true, includeUnconfigured: true, profile: "work" }),
    "/api/model/options?refresh=true&include_unconfigured=true&profile=work",
  );
  // A blank profile is dropped, not sent as an empty value.
  assert.equal(api.modelOptions({ profile: "  " }), "/api/model/options");
  assert.equal(api.modelSet("work"), "/api/model/set?profile=work");
  assert.equal(api.modelSet(""), "/api/model/set");
});

test("session transcript keeps stored-id slashes as path separators", () => {
  assert.equal(
    api.sessionMessages("abc/def"),
    "/api/sessions/abc/def/messages?order=latest&limit=200&profile=default",
  );
  assert.equal(
    api.sessionMessages("abc", { limit: 50, profile: "work" }),
    "/api/sessions/abc/messages?order=latest&limit=50&profile=work",
  );
  // Runs have opaque ids, so the whole id is encoded instead.
  assert.equal(
    api.cronRunMessages("run 1", "work"),
    "/api/sessions/run%201/messages?order=oldest&limit=100&profile=work",
  );
  assert.equal(
    api.cronRunMessages("r1", ""),
    "/api/sessions/r1/messages?order=oldest&limit=100",
  );
});

test("withProfile appends without clobbering an existing query", () => {
  assert.equal(api.withProfile("/api/x", ""), "/api/x");
  assert.equal(api.withProfile("/api/x", "  "), "/api/x");
  assert.equal(api.withProfile("/api/x", "work"), "/api/x?profile=work");
  assert.equal(api.withProfile("/api/x?a=1", "work"), "/api/x?a=1&profile=work");
  // Path segments are encoded.
  assert.equal(api.withProfile("/api/x", "a b"), "/api/x?profile=a%20b");
});

test("cron routes", () => {
  assert.equal(api.cronJobsAllProfiles(), "/api/cron/jobs?profile=all");
  assert.equal(api.cronJobs(), "/api/cron/jobs");
  assert.equal(api.cronJobs("work"), "/api/cron/jobs?profile=work");
  assert.equal(api.cronJob("j1"), "/api/cron/jobs/j1");
  assert.equal(api.cronJob("j1", "work"), "/api/cron/jobs/j1?profile=work");
  assert.equal(api.cronJobAction("j1", "trigger", "work"), "/api/cron/jobs/j1/trigger?profile=work");
  assert.equal(
    api.cronJobRuns("j1", "work"),
    "/api/cron/jobs/j1/runs?limit=30&profile=work",
  );
  assert.equal(api.cronJobRuns("j1"), "/api/cron/jobs/j1/runs?limit=30");
  assert.equal(api.cronJobRuns("j 1", "", 5), "/api/cron/jobs/j%201/runs?limit=5");
});

test("kanban routes take a caller-built board query", () => {
  assert.equal(api.kanbanBoards(), "/api/plugins/kanban/boards");
  assert.equal(
    api.kanbanBoardsWithArchived(),
    "/api/plugins/kanban/boards?include_archived=true",
  );
  assert.equal(api.kanbanBoard(), "/api/plugins/kanban/board");
  assert.equal(api.kanbanBoard("?board=main"), "/api/plugins/kanban/board?board=main");
  assert.equal(api.kanbanTasks("?board=main"), "/api/plugins/kanban/tasks?board=main");
  assert.equal(api.kanbanTask("t 1", "?board=main"), "/api/plugins/kanban/tasks/t%201?board=main");
});

test("file routes always send path unless explicitly omitted", () => {
  assert.equal(api.files("/"), "/api/files?path=%2F");
  assert.equal(api.files(""), "/api/files?path=");
  assert.equal(api.files("a b/c"), "/api/files?path=a%20b%2Fc");
  assert.equal(api.filesRoot(), "/api/files");
  assert.equal(api.fileRead("~/x.md"), "/api/files/read?path=~%2Fx.md");
  assert.equal(api.filesMkdir(), "/api/files/mkdir");
  assert.equal(api.filesUpload(), "/api/files/upload");
});

test("log routes let the caller decide whether level is sent", () => {
  assert.equal(
    api.logs({ file: "agent", lines: 200 }),
    "/api/logs?file=agent&lines=200",
  );
  assert.equal(
    api.logs({ file: "agent", lines: "200", level: "INFO" }),
    "/api/logs?file=agent&lines=200&level=INFO",
  );
  assert.equal(
    api.logs({ file: "errors", lines: 50, level: "ERROR", search: "timeout" }),
    "/api/logs?file=errors&lines=50&level=ERROR&search=timeout",
  );
});

test("analytics and portal routes", () => {
  assert.equal(api.usage(7), "/api/analytics/usage?days=7");
  assert.equal(api.usageLast7Days(), "/api/analytics/usage?days=7");
  assert.equal(api.usage(30), "/api/analytics/usage?days=30");
  assert.equal(api.portal(), "/api/portal");
});

test("skill routes", () => {
  assert.equal(api.skills(), "/api/skills");
  assert.equal(api.skillContent("My Skill"), "/api/skills/content?name=My%20Skill");
  assert.equal(api.skillToggle(), "/api/skills/toggle");
});

test("toolset routes always resolve a profile namespace", () => {
  assert.equal(api.toolsets("work"), "/api/tools/toolsets?profile=work");
  // Empty profile falls back to `default` here rather than being omitted.
  assert.equal(api.toolsets(""), "/api/tools/toolsets?profile=default");
  assert.equal(api.toolsets(), "/api/tools/toolsets?profile=default");
  assert.equal(
    api.toolsetToggle("discord", "work"),
    "/api/tools/toolsets/discord?profile=work",
  );
  assert.equal(api.toolsetToggle("a b"), "/api/tools/toolsets/a%20b?profile=default");
});

test("update and gateway action routes", () => {
  assert.equal(api.actionStatus("hermes-update", 400), "/api/actions/hermes-update/status?lines=400");
  assert.equal(api.updateCheck(), "/api/hermes/update/check");
  assert.equal(
    api.updateCheck({ force: true, profile: "work" }),
    "/api/hermes/update/check?force=true&profile=work",
  );
  assert.equal(api.updateReceipt(), "/api/hermes/update/receipt");
  assert.equal(api.updateApply(), "/api/hermes/update");
  assert.equal(api.gatewayRestart(), "/api/gateway/restart");
});
