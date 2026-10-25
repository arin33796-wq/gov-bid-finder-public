import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { F } from "../scripts/sam-lib.js";
import { writeSplitFiles } from "../scripts/split-data.js";
import {
  FIRST_PAINT_DAYS, FLORIDA_SOURCES, PRIORITY_FILE, REST_FILE, FULL_FILE, ROW,
  addISODays, isPriorityRow, splitRows, coveredByFirstPaint, mergeSnapshot, loadSnapshot,
} from "../snapshot.js";

const sources = ["sam.gov", "myfloridamarketplace", "miami-dade"];
const today = "2026-10-25";
const row = (id, state, due, src) => {
  const r = Array(22).fill("");
  r[ROW.ID] = id;
  r[ROW.DUE] = due;
  r[ROW.STATE] = state;
  r[ROW.SRC] = src;
  return r;
};

test("row indexes match the shared layout", () => {
  assert.equal(ROW.ID, F.ID);
  assert.equal(ROW.DUE, F.DUE);
  assert.equal(ROW.STATE, F.STATE);
  assert.equal(ROW.SRC, F.SRC);
});

test("file names are plain relative names", () => {
  for (const name of [PRIORITY_FILE, REST_FILE, FULL_FILE]) {
    assert.equal(name.includes("/"), false);
    assert.equal(name.includes(":"), false);
  }
});

test("the 90-day cutoff is the snapshot day plus 90 calendar days", () => {
  assert.equal(FIRST_PAINT_DAYS, 90);
  assert.equal(addISODays("2026-10-25", 90), "2027-01-23");
  assert.equal(addISODays("2026-12-31", 1), "2027-01-01");
});

test("priority is Florida, the two local sources, and deadlines inside 90 days", () => {
  const far = addISODays(today, 91);
  const edge = addISODays(today, 90);
  const dicts = { sources };
  const rows = [
    row("fl-far", "FL", far, 0),
    row("mdc-blank", "", far, 2),
    row("mfmp-ga", "GA", far, 1),
    row("soon", "TX", edge, 0),
    row("today", "CA", today, 0),
    row("blank-soon", "", addISODays(today, 10), 0),
    row("late", "TX", far, 0),
    row("past", "GA", "2026-10-24", 0),
    row("nodue", "GA", "", 0),
  ];
  const { first, rest } = splitRows(rows, dicts, today);
  assert.deepEqual(first.map((r) => r[0]), ["fl-far", "mdc-blank", "mfmp-ga", "soon", "today", "blank-soon"]);
  assert.deepEqual(rest.map((r) => r[0]), ["late", "past", "nodue"]);
  // Each input row is in exactly one side, still the same array.
  const seen = new Map();
  for (const r of first.concat(rest)) seen.set(r, (seen.get(r) || 0) + 1);
  for (const r of rows) assert.equal(seen.get(r), 1);
  assert.equal(first.length + rest.length, rows.length);
  for (const r of first) assert.equal(isPriorityRow(r, sources, today), true);
  for (const r of rest) assert.equal(isPriorityRow(r, sources, today), false);
  // A row that is both Florida and due soon is not duplicated.
  const both = [row("both", "FL", today, 0)];
  const once = splitRows(both, dicts, today);
  assert.equal(once.first.length, 1);
  assert.equal(once.rest.length, 0);
});

test("a filtered view is complete only when the priority file holds every row it can show", () => {
  const fresh = { complete: false, snapshotToday: today, userToday: today };
  assert.equal(coveredByFirstPaint({ ...fresh, state: "FL", days: 0 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, state: "TX", days: 90 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, state: "TX", days: 30 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, state: "", days: 7 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, state: "TX", days: 91 }), false);
  assert.equal(coveredByFirstPaint({ ...fresh, state: "", days: 0 }), false);
  assert.equal(coveredByFirstPaint({ ...fresh, source: "miami-dade", days: 0 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, source: "myfloridamarketplace", days: 0 }), true);
  assert.equal(coveredByFirstPaint({ ...fresh, source: "sam.gov", days: 0 }), false);
  assert.equal(coveredByFirstPaint({ complete: true, state: "", days: 0 }), true);
  // Five days after the snapshot, a 90-day window reaches past the first file.
  assert.equal(coveredByFirstPaint({ ...fresh, userToday: "2026-10-30", state: "TX", days: 90 }), false);
  assert.equal(coveredByFirstPaint({ ...fresh, userToday: "2026-10-30", state: "TX", days: 85 }), true);
  assert.ok(FLORIDA_SOURCES.includes("miami-dade"));
});

test("merge accepts the matching half and refuses a stale or overlapping one", () => {
  const meta = { total: 2, built_at: "t", today, dicts: { sources } };
  const a = row("a", "FL", today, 0);
  const b = row("b", "TX", addISODays(today, 200), 0);
  const priority = { meta, rows: [a] };
  assert.equal(mergeSnapshot(priority, null).complete, false);
  assert.equal(mergeSnapshot(priority, null).rows.length, 1);
  const ok = mergeSnapshot(priority, { built_at: "t", rows: [b] });
  assert.equal(ok.complete, true);
  assert.deepEqual(ok.rows.map((r) => r[0]), ["a", "b"]);
  assert.equal(mergeSnapshot(priority, { built_at: "other", rows: [b] }).complete, false);
  assert.equal(mergeSnapshot(priority, { built_at: "t", rows: [a] }).complete, false);
  assert.equal(mergeSnapshot(priority, { built_at: "t", rows: [b, row("c", "TX", "2027-06-01", 0)] }).complete, false);
  const whole = { meta: { ...meta, total: 1 }, rows: [a] };
  assert.equal(mergeSnapshot(whole, null).complete, true);
  assert.equal(mergeSnapshot(null, null), null);
});

test("loadSnapshot paints from the priority file and falls back to data.json", async () => {
  const meta = { total: 2, built_at: "t", today, dicts: { sources }, awards_by_month: [] };
  const a = row("a", "FL", today, 0);
  const b = row("b", "TX", addISODays(today, 200), 0);
  const files = {
    [PRIORITY_FILE]: { meta, rows: [a] },
    [REST_FILE]: { built_at: "t", rows: [b] },
    [FULL_FILE]: { meta, rows: [a, b] },
  };
  const fetched = [];
  const fetchJson = async (name) => {
    fetched.push(name);
    if (!files[name]) throw new Error("missing " + name);
    return files[name];
  };
  const loaded = await loadSnapshot(fetchJson);
  assert.equal(loaded.complete, false);
  assert.equal(loaded.priority.rows.length, 1);
  // The rest file is not read until finish(), so its parse stays off the first paint.
  assert.deepEqual(fetched, [PRIORITY_FILE]);
  const full = await loaded.finish();
  assert.equal(full.complete, true);
  assert.deepEqual(full.rows.map((r) => r[0]), ["a", "b"]);
  assert.deepEqual(fetched, [PRIORITY_FILE, REST_FILE]);

  const fetched2 = [];
  const broken = await loadSnapshot(async (name) => {
    fetched2.push(name);
    if (name === FULL_FILE) return files[FULL_FILE];
    throw new Error("nope");
  });
  assert.equal(broken.complete, true);
  assert.deepEqual((await broken.finish()).rows.map((r) => r[0]), ["a", "b"]);
  assert.ok(fetched2.includes(FULL_FILE));

  const fetched3 = [];
  const stale = {
    [PRIORITY_FILE]: files[PRIORITY_FILE],
    [REST_FILE]: { built_at: "old", rows: [b] },
    [FULL_FILE]: files[FULL_FILE],
  };
  const recovered = await loadSnapshot(async (name) => {
    fetched3.push(name);
    if (!stale[name]) throw new Error(name);
    return stale[name];
  });
  const back = await recovered.finish();
  assert.equal(back.complete, true);
  assert.deepEqual(back.rows.map((r) => r[0]), ["a", "b"]);
  assert.ok(fetched3.includes(FULL_FILE));
});

test("the rest file downloads during the priority fetch and is parsed only when finished", async () => {
  const meta = { total: 2, built_at: "t", today, dicts: { sources } };
  const a = row("a", "FL", today, 0);
  const b = row("b", "TX", addISODays(today, 200), 0);
  let parsed = false;
  let opened = false;
  const loaded = await loadSnapshot(async (name) => {
    if (name !== PRIORITY_FILE) throw new Error(name);
    return { meta, rows: [a] };
  }, () => {
    opened = true;
    return { json: async () => { parsed = true; return { built_at: "t", rows: [b] }; } };
  });
  assert.equal(opened, true);
  assert.equal(parsed, false);
  assert.equal(loaded.complete, false);
  const full = await loaded.finish();
  assert.equal(parsed, true);
  assert.equal(full.complete, true);
  assert.deepEqual(full.rows.map((r) => r[0]), ["a", "b"]);
});

test("writeSplitFiles re-partitions a snapshot without dropping rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "govbid-split-"));
  try {
    const far = addISODays(today, 120);
    const data = {
      meta: { total: 3, built_at: "t", today, dicts: { sources } },
      rows: [row("a", "FL", far, 0), row("b", "TX", today, 0), row("c", "TX", far, 0)],
    };
    const n = writeSplitFiles(data, dir);
    assert.deepEqual(n, { first: 2, rest: 1, total: 3 });
    const pri = JSON.parse(readFileSync(join(dir, PRIORITY_FILE), "utf8"));
    const rest = JSON.parse(readFileSync(join(dir, REST_FILE), "utf8"));
    assert.deepEqual(pri.meta, data.meta);
    assert.equal(rest.built_at, "t");
    assert.deepEqual(pri.rows.map((r) => r[0]).concat(rest.rows.map((r) => r[0])), ["a", "b", "c"]);
    const merged = mergeSnapshot(pri, rest);
    assert.equal(merged.complete, true);
    assert.equal(merged.rows.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the committed split is a pure re-partition of data.json", () => {
  const data = JSON.parse(readFileSync("data.json", "utf8"));
  const pri = JSON.parse(readFileSync(PRIORITY_FILE, "utf8"));
  const rest = JSON.parse(readFileSync(REST_FILE, "utf8"));
  assert.deepEqual(pri.meta, data.meta);
  assert.equal(rest.built_at, data.meta.built_at);
  const expect = splitRows(data.rows, data.meta.dicts, data.meta.today);
  assert.equal(pri.rows.length + rest.rows.length, data.rows.length);
  assert.deepEqual(pri.rows, expect.first);
  assert.deepEqual(rest.rows, expect.rest);
  const ids = new Set();
  for (const r of pri.rows.concat(rest.rows)) {
    assert.equal(ids.has(r[ROW.ID]), false, r[ROW.ID]);
    ids.add(r[ROW.ID]);
  }
  assert.equal(ids.size, data.rows.length);
  for (const r of data.rows) assert.equal(ids.has(r[ROW.ID]), true);
  const merged = mergeSnapshot(pri, rest);
  assert.equal(merged.complete, true);
  assert.equal(merged.rows.length, data.rows.length);
  // WHY 16 MB: the artifact that hosts the page refuses a larger file.
  const MAX_FILE_BYTES = 16 * 1024 * 1024;
  for (const f of [FULL_FILE, PRIORITY_FILE, REST_FILE]) assert.ok(statSync(f).size < MAX_FILE_BYTES, f);
});
