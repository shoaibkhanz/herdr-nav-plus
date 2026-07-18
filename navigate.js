#!/usr/bin/env node
"use strict";

// herdr-nav-plus — extend Ctrl+j / Ctrl+k past pane edges into workspaces.
//
// The "+" over vim-herdr-navigation: it keeps the full vim <-> pane behaviour,
// then adds one more layer on the VERTICAL axis (Ctrl+j / Ctrl+k):
//
//   vim split  ->  herdr pane  ->  workspace (space)
//
// The chain (down = Ctrl+j, up = Ctrl+k):
//   1. If the focused pane runs Vim/Neovim, forward the chord so Vim moves its
//      own split (same detection as vim-herdr-navigation; credited there).
//   2. Else if there is a pane in that direction, move herdr's pane focus.
//   3. Else (vertical pane-grid edge) walk the WORKSPACE list (the sidebar
//      order: ascending workspace number), wrapping at both ends so Ctrl+j past
//      the last workspace loops to the first and Ctrl+k past the first loops to
//      the last.
//
// The herdr sidebar is a flat list of workspaces; each workspace's agent status
// rolls up into that one row (see herdr concepts docs), so there is no separate
// "agents" list to visit — focusing a workspace lands you on its pane/agent.
//
// Horizontal chords (Ctrl+h / Ctrl+l) stay pane-only: workspaces live on the
// vertical sidebar axis, so at a horizontal edge we simply stop.
//
// On every hop we focus the target workspace (herdr's sidebar auto-highlights
// the focused row) AND fire a positioned toast naming it and your place in the
// walk ("workspace 4/14"), so you always see where the navigation landed.
//
// herdr focus always lives ON a pane — there is no "focus is in the sidebar"
// state to read. So the walk keeps a tiny cursor in a temp file keyed by the
// pane we last focused; if you navigate away by other means the cursor resyncs
// to the live focused workspace. See selectTarget() for the pure core.
//
// Usage: node navigate.js <left|down|up|right|h|j|k|l> [--edge]
//   --edge  skip the Vim-forward step (used by the editor callback at a split
//           edge, so we never bounce the chord back into Vim).

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const HERDR = process.env.HERDR_BIN_PATH || "herdr";

// Foreground process names that mean "Vim owns this pane" — same matcher as
// vim-tmux-navigator / vim-herdr-navigation: vi, vim, nvim, view, gvim, *diff.
const VIM_RE = /^g?(view|l?n?vim?x?)(diff)?$/;

const KEY_BY_DIR = { left: "ctrl+h", down: "ctrl+j", up: "ctrl+k", right: "ctrl+l" };
const DIR_ALIASES = { left: "left", right: "right", up: "up", down: "down", h: "left", l: "right", k: "up", j: "down" };

// ---------------------------------------------------------------------------
// Pure core — the test surface. No I/O.
// ---------------------------------------------------------------------------

// Spaces in walk order: ascending workspace number, workspace_id as tiebreak.
function orderSpaces(workspaces) {
  return (Array.isArray(workspaces) ? workspaces : [])
    .filter((w) => w && w.workspace_id)
    .slice()
    .sort(
      (a, b) =>
        (a.number || 0) - (b.number || 0) ||
        String(a.workspace_id).localeCompare(String(b.workspace_id))
    );
}

// The navigation ring: every workspace, in sidebar order. This is the flat
// vertical list the sidebar draws (each row's agent status rolls up into it).
function buildRing(orderedSpaces) {
  return (Array.isArray(orderedSpaces) ? orderedSpaces : []).map((s) => ({
    workspace_id: s.workspace_id,
    number: s.number,
    label: s.label,
  }));
}

function focusedSpaceIndex(ring, focusedWorkspaceId) {
  return ring.findIndex((e) => e.workspace_id === focusedWorkspaceId);
}

// Where does the walk resume from? Trust the stored cursor only while focus is
// still on the pane we last landed on (i.e. the user is mid-walk). Otherwise the
// user moved by other means, so resync to the live focused space.
function resolveCursor(ring, state, currentPaneId, focusedWorkspaceId) {
  if (
    state &&
    state.lastPane != null &&
    state.lastPane === currentPaneId &&
    Number.isInteger(state.cursor) &&
    state.cursor >= 0 &&
    state.cursor < ring.length
  ) {
    return state.cursor;
  }
  const i = focusedSpaceIndex(ring, focusedWorkspaceId);
  return i >= 0 ? i : 0;
}

// One step along the ring, wrapping at both ends: down past the last workspace
// loops to the first, up past the first loops to the last. The workspace list is
// a single cycle so Ctrl+j/Ctrl+k never dead-ends.
function stepCursor(cursor, direction, length) {
  if (length <= 0) return cursor;
  const delta = direction === "down" ? 1 : -1;
  return (((cursor + delta) % length) + length) % length;
}

// Decide the walk target. Returns { from, index, entry }: `from` is the resumed
// cursor, `index` the stepped (wrapped) cursor, `entry` the ring node to focus.
// from === index only when the ring has a single entry — then the caller does
// nothing (there is nowhere else to go).
function selectTarget(ring, { state, currentPaneId, focusedWorkspaceId, direction } = {}) {
  if (!Array.isArray(ring) || ring.length === 0) return { from: -1, index: -1, entry: null };
  const from = resolveCursor(ring, state, currentPaneId, focusedWorkspaceId);
  const index = stepCursor(from, direction, ring.length);
  return { from, index, entry: ring[index] };
}

// Human-facing description of a ring slot, for the highlight toast: its label
// and its 1-based position within the workspace list ("workspace 4/14").
function describeTarget(ring, index) {
  const entry = ring[index];
  if (!entry) return null;
  return {
    label: entry.label || entry.workspace_id,
    position: index + 1,
    total: ring.length,
  };
}

function normalizeDir(raw) {
  return DIR_ALIASES[String(raw || "").toLowerCase()] || null;
}

// ---------------------------------------------------------------------------
// I/O adapter — thin calls into the herdr CLI + a tiny state file.
// ---------------------------------------------------------------------------

function herdr(args) {
  const r = spawnSync(HERDR, args, { encoding: "utf8" });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    throw new Error(`herdr ${args.join(" ")}: ${msg}`);
  }
  return r.stdout;
}

function herdrJson(args) {
  return JSON.parse(herdr(args));
}

function isVimForeground() {
  try {
    const info = herdrJson(["pane", "process-info", "--current"]);
    const procs = (info && info.result && info.result.process_info &&
      info.result.process_info.foreground_processes) || [];
    let passRe = null;
    const passRaw = process.env.HERDR_NAV_PASSTHROUGH_RE || "";
    if (passRaw) {
      try { passRe = new RegExp(passRaw); } catch (_) { passRe = null; }
    }
    return procs.some((p) => {
      const name = String((p && p.name) || "").toLowerCase();
      return VIM_RE.test(name) || (passRe != null && passRe.test(name));
    });
  } catch (_) {
    return false;
  }
}

// edges[dir] === true means "this pane is at the <dir> edge" (no pane beyond).
function paneEdges() {
  try {
    const info = herdrJson(["pane", "edges", "--current"]);
    return (info && info.result && info.result.edges) || null;
  } catch (_) {
    return null;
  }
}

function currentPane() {
  try {
    const info = herdrJson(["pane", "current", "--current"]);
    const p = (info && info.result && info.result.pane) || {};
    return { pane_id: p.pane_id, workspace_id: p.workspace_id };
  } catch (_) {
    return {};
  }
}

function listWorkspaces() {
  try {
    return herdrJson(["workspace", "list"]).result.workspaces || [];
  } catch (_) {
    return [];
  }
}

// Highlight the hop: herdr's sidebar already bolds the focused workspace when we
// focus it; this toast names it and shows how far along the walk you are.
function notify(title, body) {
  const args = ["notification", "show", title];
  if (body) args.push("--body", body);
  args.push("--position", "top-right", "--sound", "none");
  try {
    herdr(args);
  } catch (_) {
    /* best-effort */
  }
}

function stateFile() {
  // Herdr injects HERDR_PLUGIN_STATE_DIR for action commands and owns its
  // lifecycle (see the herdr plugins docs, "Commands and environment"), so keep
  // the cursor there. Fall back to a temp file for manual runs and tests, where
  // that env var is absent.
  const dir = process.env.HERDR_PLUGIN_STATE_DIR || os.tmpdir();
  return path.join(dir, "herdr-nav-plus-cursor.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch (_) {
    return null;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch (_) {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

function walkVertical(dir) {
  const workspaces = orderSpaces(listWorkspaces());
  const ring = buildRing(workspaces);
  if (ring.length === 0) return;

  const cur = currentPane();
  const focusedWorkspaceId = (workspaces.find((w) => w.focused) || {}).workspace_id;

  const { from, index, entry } = selectTarget(ring, {
    state: loadState(),
    currentPaneId: cur.pane_id,
    focusedWorkspaceId,
    direction: dir,
  });

  if (!entry || index === from) return; // single-workspace ring: nowhere to go

  herdr(["workspace", "focus", entry.workspace_id]);

  saveState({ cursor: index, lastPane: currentPane().pane_id });

  const d = describeTarget(ring, index);
  if (d) notify(`\u25B8 ${d.label}`, `workspace ${d.position}/${d.total}`);
}

function main() {
  const dir = normalizeDir(process.argv[2]);
  if (!dir) {
    process.stderr.write("usage: navigate.js <left|down|up|right> [--edge]\n");
    process.exit(2);
  }
  const edgeOnly = process.argv.includes("--edge");
  const pane = process.env.HERDR_PANE_ID || "";

  // 1. Forward into Vim when it owns the pane (skipped on the editor callback).
  if (!edgeOnly && pane && isVimForeground()) {
    herdr(["pane", "send-keys", pane, KEY_BY_DIR[dir]]);
    return;
  }

  // 2. Move pane focus when there is a pane in that direction.
  const edges = paneEdges();
  const atEdge = edges ? edges[dir] === true : false;
  if (!atEdge) {
    herdr(["pane", "focus", "--direction", dir, "--current"]);
    return;
  }

  // 3. At the pane-grid edge. Horizontal stops; vertical walks workspaces.
  if (dir === "left" || dir === "right") return;
  walkVertical(dir);
}

if (require.main === module) main();

module.exports = {
  orderSpaces,
  buildRing,
  focusedSpaceIndex,
  resolveCursor,
  stepCursor,
  selectTarget,
  describeTarget,
  normalizeDir,
  VIM_RE,
};
