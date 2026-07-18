"use strict";

// End-to-end tests for the orchestration chain in main() / walkVertical().
//
// navigate.js already exposes a seam for its only I/O dependency: HERDR_BIN_PATH
// (const HERDR = process.env.HERDR_BIN_PATH || "herdr"). We point it at a fake
// `herdr` that logs every invocation's argv and answers the read subcommands
// from a fixture. That drives the real decision chain — vim-forward -> pane
// focus -> workspace walk -> toast — without a live herdr and without mutating
// the user's focus.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const NAV = path.join(__dirname, "navigate.js");

const STUB = [
  "#!/usr/bin/env node",
  '"use strict";',
  "const fs = require('fs');",
  "const args = process.argv.slice(2);",
  "fs.appendFileSync(process.env.STUB_LOG, args.join(' ') + '\\n');",
  "const fx = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const emit = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };",
  "const [a, b] = args;",
  "if (a === 'pane' && b === 'process-info') emit({ result: { process_info: { foreground_processes: fx.vim ? [{ name: 'nvim' }] : [{ name: 'bash' }] } } });",
  "if (a === 'pane' && b === 'edges') emit({ result: { edges: fx.edges } });",
  "if (a === 'pane' && b === 'current') emit({ result: { pane: fx.pane } });",
  "if (a === 'workspace' && b === 'list') emit({ result: { workspaces: fx.workspaces } });",
  "process.exit(0); // writes (workspace focus / pane focus / send-keys / notification) just succeed",
  "",
].join("\n");

const WS = [
  { workspace_id: "wA", number: 1, label: "alpha", focused: false },
  { workspace_id: "wB", number: 2, label: "beta", focused: true },
  { workspace_id: "wC", number: 3, label: "gamma", focused: false },
];

function run(argv, fixture, { pane = "wB:p1", dir } = {}) {
  const home = dir || fs.mkdtempSync(path.join(os.tmpdir(), "nav-orch-"));
  const stub = path.join(home, "herdr-stub.js");
  const log = path.join(home, "log.txt");
  const fx = path.join(home, "fixture.json");
  fs.writeFileSync(stub, STUB);
  fs.chmodSync(stub, 0o755);
  fs.writeFileSync(fx, JSON.stringify(fixture));
  if (!dir) fs.writeFileSync(log, "");
  else fs.writeFileSync(log, ""); // reset the log between runs, keep the state file
  const r = spawnSync("node", [NAV, ...argv], {
    encoding: "utf8",
    env: {
      ...process.env,
      HERDR_BIN_PATH: stub,
      HERDR_PANE_ID: pane,
      HERDR_PLUGIN_STATE_DIR: home,
      STUB_LOG: log,
      STUB_FIXTURE: fx,
    },
  });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { status: r.status, stderr: r.stderr, calls, dir: home };
}

test("forwards the chord into Vim when Vim owns the pane", () => {
  const fx = { vim: true, edges: { down: false }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const { calls } = run(["down"], fx, { pane: "wB:p1" });
  assert.deepEqual(calls, ["pane process-info --current", "pane send-keys wB:p1 ctrl+j"]);
});

test("moves pane focus when a pane exists in that direction", () => {
  const fx = { vim: false, edges: { down: false }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const { calls } = run(["down"], fx);
  assert.deepEqual(calls, [
    "pane process-info --current",
    "pane edges --current",
    "pane focus --direction down --current",
  ]);
});

test("walks to the next workspace at the vertical pane edge, then toasts", () => {
  const fx = { vim: false, edges: { down: true }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const { calls } = run(["down"], fx);
  assert.equal(calls[0], "pane process-info --current");
  assert.equal(calls[1], "pane edges --current");
  assert.equal(calls[2], "workspace list");
  assert.ok(calls.includes("workspace focus wC"), "focuses the next workspace (wB -> wC)");
  assert.ok(calls.some((c) => c.startsWith("notification show")), "fires a positioned toast");
});

test("wraps past the last workspace to the first at the bottom edge", () => {
  const ws = WS.map((w) => ({ ...w, focused: w.workspace_id === "wC" }));
  const fx = { vim: false, edges: { down: true }, pane: { pane_id: "wC:p1", workspace_id: "wC" }, workspaces: ws };
  const { calls } = run(["down"], fx, { pane: "wC:p1" });
  assert.ok(calls.includes("workspace focus wA"), "wraps to the first workspace");
});

test("wraps past the first workspace to the last at the top edge", () => {
  const ws = WS.map((w) => ({ ...w, focused: w.workspace_id === "wA" }));
  const fx = { vim: false, edges: { up: true }, pane: { pane_id: "wA:p1", workspace_id: "wA" }, workspaces: ws };
  const { calls } = run(["up"], fx, { pane: "wA:p1" });
  assert.ok(calls.includes("workspace focus wC"), "wraps to the last workspace");
});

test("stops at a horizontal pane edge (never walks workspaces)", () => {
  const fx = { vim: false, edges: { left: true }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const { calls } = run(["left"], fx);
  assert.deepEqual(calls, ["pane process-info --current", "pane edges --current"]);
  assert.ok(!calls.some((c) => c.startsWith("workspace")), "no workspace calls on the horizontal axis");
});

test("--edge skips the Vim-forward step even when Vim owns the pane", () => {
  const fx = { vim: true, edges: { down: true }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const { calls } = run(["down", "--edge"], fx);
  assert.ok(!calls.includes("pane process-info --current"), "does not probe Vim on the editor callback");
  assert.equal(calls[0], "pane edges --current");
  assert.ok(calls.includes("workspace focus wC"));
});

test("persists the cursor across invocations (stored cursor resumes the walk)", () => {
  const fx = { vim: false, edges: { down: true }, pane: { pane_id: "wB:p1", workspace_id: "wB" }, workspaces: WS };
  const first = run(["down"], fx); // focused wB(1) -> wC(2)
  assert.ok(first.calls.includes("workspace focus wC"));
  const second = run(["down"], fx, { dir: first.dir }); // resume cursor 2 -> wrap to wA(0)
  assert.ok(
    second.calls.includes("workspace focus wA"),
    "second hop resumes from the stored cursor and wraps, not from the focused workspace"
  );
});

test("exits non-zero on a bad direction argument", () => {
  const fx = { vim: false, edges: {}, pane: {}, workspaces: WS };
  const { status, stderr } = run(["sideways"], fx);
  assert.equal(status, 2);
  assert.match(stderr, /usage:/);
});
