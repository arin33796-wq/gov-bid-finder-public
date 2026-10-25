// How the contract snapshot is split for the first paint, and how the page
// puts it back together. No DOM and no filesystem, so the tests and the build
// can both drive it.

// WHY 90: the widest deadline preset on the dashboard, and about a quarter ahead.
// Florida rows are included however far out they are. Anything due later is in
// the second file and merges in after the first paint.
export const FIRST_PAINT_DAYS = 90;

// WHY these two: MyFloridaMarketplace and Miami-Dade are the local bids this
// site opens on. A blank or non-FL state must not leave them in the second file.
export const FLORIDA_SOURCES = ["myfloridamarketplace", "miami-dade"];

// WHY these names: the page fetches the priority file, paints, then the rest.
// data.json stays the whole snapshot, so a failed priority fetch still has one
// file to load. Names are relative; the page never builds an absolute URL.
export const PRIORITY_FILE = "data-priority.json";
export const REST_FILE = "data-rest.json";
export const FULL_FILE = "data.json";

// WHY these indexes: they are the row layout (F in app.js and scripts/sam-lib.js).
// State, source and deadline decide which file a row belongs in.
export const ROW = { ID: 0, DUE: 5, STATE: 7, SRC: 10 };

// Add days to a YYYY-MM-DD string. UTC, so a US timezone cannot shift the day.
export const addISODays = (iso, days) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export function isPriorityRow(row, sources, today, days = FIRST_PAINT_DAYS) {
  if (row[ROW.STATE] === "FL") return true;
  const src = sources[row[ROW.SRC]] || "";
  if (FLORIDA_SOURCES.includes(src)) return true;
  const due = row[ROW.DUE];
  if (!due || due < today) return false;
  return due <= addISODays(today, days);
}

// Same row objects, original order inside each file, each row in exactly one file.
export function splitRows(rows, dicts, today, days = FIRST_PAINT_DAYS) {
  const sources = dicts?.sources || [];
  const first = [], rest = [];
  for (const row of rows) (isPriorityRow(row, sources, today, days) ? first : rest).push(row);
  return { first, rest };
}

// A filtered view is already complete from the priority file when it cannot
// ask for a row that file left out. Florida and the two local sources are
// entirely in that file. A deadline window is, only when it ends on or before
// the snapshot's own 90-day cutoff. A snapshot from last week does not hold
// every notice due within 90 days of today.
export function coveredByFirstPaint({ state = "", source = "", days = 0, complete = false, snapshotToday = "", userToday = "" } = {}) {
  if (complete) return true;
  if (state === "FL") return true;
  if (FLORIDA_SOURCES.includes(source)) return true;
  if (!(days > 0) || !snapshotToday || !userToday) return false;
  return addISODays(userToday, days) <= addISODays(snapshotToday, FIRST_PAINT_DAYS);
}

// Accept the rest file only when it is the other half of this snapshot.
// A mismatch leaves the priority rows in place and reports the load incomplete,
// so the page does not present a partial count as the total.
export function mergeSnapshot(priority, rest) {
  if (!priority?.meta || !Array.isArray(priority.rows) || typeof priority.meta.total !== "number") return null;
  const base = { meta: priority.meta, rows: priority.rows, complete: false };
  if (priority.rows.length === priority.meta.total) return { ...base, complete: true };
  if (!rest || rest.built_at !== priority.meta.built_at || !Array.isArray(rest.rows)) return base;
  if (priority.rows.length + rest.rows.length !== priority.meta.total) return base;
  const seen = new Set();
  for (const r of priority.rows) {
    if (seen.has(r[ROW.ID])) return base;
    seen.add(r[ROW.ID]);
  }
  for (const r of rest.rows) {
    if (seen.has(r[ROW.ID])) return base;
    seen.add(r[ROW.ID]);
  }
  return { meta: priority.meta, rows: priority.rows.concat(rest.rows), complete: true };
}

// fetchJson(name) returns the parsed file or throws. openRest, when passed,
// starts the background download immediately and returns a Response whose body
// is left unparsed. finish() parses it, so that parse does not sit in front of
// the first paint. Without openRest, finish() fetches the rest file itself.
// Either way finish() falls back to data.json if the halves do not match.
export async function loadSnapshot(fetchJson, openRest) {
  const restResponse = openRest ? Promise.resolve().then(openRest).then((r) => r, () => null) : null;
  try {
    const priority = await fetchJson(PRIORITY_FILE);
    const early = mergeSnapshot(priority, null);
    if (!early) throw new Error("bad priority");
    return {
      priority,
      complete: early.complete,
      finish: async () => {
        if (early.complete) return early;
        let rest = null;
        try {
          if (restResponse) {
            const res = await restResponse;
            rest = res ? await res.json() : null;
          } else rest = await fetchJson(REST_FILE);
        } catch { rest = null; }
        const merged = mergeSnapshot(priority, rest);
        if (merged?.complete) return merged;
        try {
          const full = await fetchJson(FULL_FILE);
          if (full?.meta && Array.isArray(full.rows)) return { meta: full.meta, rows: full.rows, complete: full.rows.length === full.meta.total };
        } catch { /* keep the priority rows */ }
        return merged || { meta: priority.meta, rows: priority.rows, complete: false };
      },
    };
  } catch {
    const full = await fetchJson(FULL_FILE);
    const done = { meta: full.meta, rows: full.rows, complete: full.rows.length === full.meta.total };
    return { priority: full, complete: done.complete, finish: async () => done };
  }
}
