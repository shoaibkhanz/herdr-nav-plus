"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  orderSpaces,
  buildRing,
  focusedSpaceIndex,
  resolveCursor,
  stepCursor,
  selectTarget,
  describeTarget,
  normalizeDir,
} = require("./navigate.js");

// A small fixture: three workspaces (numbers 1..3). The ring is the workspace
// list in sidebar order: [wA(1), wB(2), wC(3)].
const SPACES = [
  { workspace_id: "wB", number: 2, label: "beta", focused: false },
  { workspace_id: "wA", number: 1, label: "alpha", focused: true },
  { workspace_id: "wC", number: 3, label: "gamma", focused: false },
];

function ringFixture() {
  return buildRing(orderSpaces(SPACES));
}

test("orderSpaces sorts by workspace number ascending", () => {
  assert.deepEqual(
    orderSpaces(SPACES).map((s) => s.workspace_id),
    ["wA", "wB", "wC"]
  );
});

test("orderSpaces drops entries without a workspace_id and is null-safe", () => {
  assert.deepEqual(orderSpaces(null), []);
  assert.deepEqual(orderSpaces([{ number: 1 }, { workspace_id: "wX", number: 5 }]), [
    { workspace_id: "wX", number: 5 },
  ]);
});

test("buildRing yields the workspaces in sidebar order", () => {
  assert.deepEqual(
    ringFixture().map((e) => e.workspace_id),
    ["wA", "wB", "wC"]
  );
  assert.deepEqual(ringFixture()[0], { workspace_id: "wA", number: 1, label: "alpha" });
});

test("buildRing is null-safe", () => {
  assert.deepEqual(buildRing(null), []);
});

test("focusedSpaceIndex finds the workspace, -1 when absent", () => {
  const ring = ringFixture();
  assert.equal(focusedSpaceIndex(ring, "wB"), 1);
  assert.equal(focusedSpaceIndex(ring, "nope"), -1);
});

test("stepCursor wraps at both ends", () => {
  assert.equal(stepCursor(0, "up", 5), 4); // top wraps to bottom
  assert.equal(stepCursor(4, "down", 5), 0); // bottom wraps to top
  assert.equal(stepCursor(1, "down", 5), 2);
  assert.equal(stepCursor(2, "up", 5), 1);
  assert.equal(stepCursor(0, "down", 1), 0); // single entry stays put
});

test("resolveCursor trusts the stored cursor while focus stays on the walk pane", () => {
  const ring = ringFixture();
  const state = { cursor: 2, lastPane: "wC:p1" };
  assert.equal(resolveCursor(ring, state, "wC:p1", "wC"), 2);
});

test("resolveCursor resyncs to the focused workspace when focus drifted away", () => {
  const ring = ringFixture();
  const state = { cursor: 2, lastPane: "wC:p1" };
  // Focus is now on a different pane than the one we last landed on.
  assert.equal(resolveCursor(ring, state, "wB:p9", "wB"), 1);
});

test("resolveCursor ignores an out-of-range stored cursor", () => {
  const ring = ringFixture();
  const state = { cursor: 99, lastPane: "wA:p1" };
  assert.equal(resolveCursor(ring, state, "wA:p1", "wA"), 0); // falls back to focused workspace wA
});

test("down from a mid workspace (drift) moves to the next workspace", () => {
  const ring = ringFixture();
  const r = selectTarget(ring, {
    state: null,
    currentPaneId: "wA:p1",
    focusedWorkspaceId: "wA",
    direction: "down",
  });
  assert.equal(r.from, 0);
  assert.equal(r.index, 1);
  assert.deepEqual(r.entry, { workspace_id: "wB", number: 2, label: "beta" });
});

test("up from a mid workspace moves to the previous workspace", () => {
  const ring = ringFixture();
  const r = selectTarget(ring, {
    state: null,
    currentPaneId: "wC:p1",
    focusedWorkspaceId: "wC",
    direction: "up",
  });
  assert.equal(r.from, 2);
  assert.equal(r.index, 1);
  assert.equal(r.entry.workspace_id, "wB");
});

test("down at the very bottom wraps to the first workspace", () => {
  const ring = ringFixture();
  const r = selectTarget(ring, {
    state: null,
    currentPaneId: "wC:p1",
    focusedWorkspaceId: "wC",
    direction: "down",
  });
  assert.equal(r.from, 2);
  assert.equal(r.index, 0);
  assert.equal(r.entry.workspace_id, "wA");
});

test("up at the top wraps to the last workspace", () => {
  const ring = ringFixture();
  const r = selectTarget(ring, {
    state: null,
    currentPaneId: "wA:p1",
    focusedWorkspaceId: "wA",
    direction: "up",
  });
  assert.equal(r.from, 0);
  assert.equal(r.index, 2);
  assert.equal(r.entry.workspace_id, "wC");
});

test("selectTarget on an empty ring yields nothing", () => {
  const r = selectTarget([], { direction: "down" });
  assert.equal(r.entry, null);
  assert.equal(r.index, -1);
});

test("selectTarget on a single-workspace ring is a no-op (from === index)", () => {
  const ring = buildRing(orderSpaces([{ workspace_id: "wA", number: 1, label: "solo" }]));
  const r = selectTarget(ring, {
    state: null,
    currentPaneId: "wA:p1",
    focusedWorkspaceId: "wA",
    direction: "down",
  });
  assert.equal(r.from, 0);
  assert.equal(r.index, 0);
});

test("selectTarget on a two-workspace ring moves both ways (not a no-op)", () => {
  const ring = buildRing(
    orderSpaces([
      { workspace_id: "wA", number: 1, label: "a" },
      { workspace_id: "wB", number: 2, label: "b" },
    ])
  );
  const down = selectTarget(ring, { state: null, currentPaneId: "wA:p1", focusedWorkspaceId: "wA", direction: "down" });
  assert.deepEqual([down.from, down.index], [0, 1]);
  const up = selectTarget(ring, { state: null, currentPaneId: "wA:p1", focusedWorkspaceId: "wA", direction: "up" });
  assert.deepEqual([up.from, up.index], [0, 1]); // up from the top wraps to the last (index 1)
});

test("describeTarget labels a workspace with its 1-based position out of all workspaces", () => {
  const ring = ringFixture(); // 3 workspaces
  assert.deepEqual(describeTarget(ring, 0), { label: "alpha", position: 1, total: 3 });
  assert.deepEqual(describeTarget(ring, 2), { label: "gamma", position: 3, total: 3 });
});

test("describeTarget returns null for an out-of-range index", () => {
  assert.equal(describeTarget(ringFixture(), 99), null);
});

test("normalizeDir accepts words and hjkl, rejects junk", () => {
  assert.equal(normalizeDir("j"), "down");
  assert.equal(normalizeDir("k"), "up");
  assert.equal(normalizeDir("h"), "left");
  assert.equal(normalizeDir("l"), "right");
  assert.equal(normalizeDir("DOWN"), "down");
  assert.equal(normalizeDir("nonsense"), null);
  assert.equal(normalizeDir(undefined), null);
});

test("orderSpaces breaks ties on equal numbers by workspace_id", () => {
  const same = [
    { workspace_id: "wZ", number: 1 },
    { workspace_id: "wA", number: 1 },
  ];
  assert.deepEqual(
    orderSpaces(same).map((s) => s.workspace_id),
    ["wA", "wZ"]
  );
});

test("stepCursor is a no-op on an empty ring", () => {
  assert.equal(stepCursor(0, "down", 0), 0);
});

test("resolveCursor falls back to 0 when the focused workspace is absent from the ring", () => {
  const ring = ringFixture();
  assert.equal(resolveCursor(ring, null, "wA:p1", "gone"), 0);
});

test("describeTarget falls back to the workspace_id when a label is missing", () => {
  const ring = buildRing(orderSpaces([{ workspace_id: "wZ", number: 1 }]));
  assert.deepEqual(describeTarget(ring, 0), { label: "wZ", position: 1, total: 1 });
});

test("normalizeDir maps the full direction words", () => {
  assert.equal(normalizeDir("left"), "left");
  assert.equal(normalizeDir("right"), "right");
  assert.equal(normalizeDir("up"), "up");
  assert.equal(normalizeDir("down"), "down");
});
