// How the contract snapshot is split for the first paint, and how the page
// puts it back together. No DOM and no filesystem, so the tests and the build
// can both drive it.

// WHY these two: MyFloridaMarketplace and Miami-Dade are the local bids this
// site opens on. A blank or non-FL state must not leave them in the second file.
export const FLORIDA_SOURCES = ["myfloridamarketplace", "miami-dade"];

// WHY 30: the dashboard opens on "Closing in 30 days". The national map uses
// that window and ignores the state filter. Counting it here, instead of
// shipping those rows, keeps the first file to Florida.
export const MAP_PRESET_DAYS = 30;
// WHY 7: the map's "closing this week" note, and the dashboard's week tile.
export const MAP_SOON_DAYS = 7;

// WHY 1_500_000: the first file should sit near a megabyte. Florida plus the
// map preset is a few hundred KB. Past this, the rest of the country is back
// on the critical path and the refresh should refuse to publish.
export const PRIORITY_MAX_BYTES = 1_500_000;

// WHY these names: the page fetches the priority file, paints, then the rest.
// data.json stays the whole snapshot for the build, ask.js, and the refresh
// check. The page does not fetch it. The two halves already are that snapshot,
// and a fallback would download every row a second time.
export const PRIORITY_FILE = "data-priority.json";
export const REST_FILE = "data-rest.json";
export const FULL_FILE = "data.json";

// WHY these indexes: they are the row layout (F in app.js and scripts/sam-lib.js).
// State and source decide which file a row belongs in. Deadline is only for the map.
export const ROW = { ID: 0, DUE: 5, STATE: 7, SRC: 10 };

// Add days to a YYYY-MM-DD string. UTC, so a US timezone cannot shift the day.
export const addISODays = (iso, days) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export function isPriorityRow(row, sources) {
  if (row[ROW.STATE] === "FL") return true;
  const src = sources[row[ROW.SRC]] || "";
  return FLORIDA_SOURCES.includes(src);
}

// Same row objects, original order inside each file, each row in exactly one file.
// Florida (and the two local sources) is the first file. Everything else waits.
export function splitRows(rows, dicts) {
  const sources = dicts?.sources || [];
  const first = [], rest = [];
  for (const row of rows) (isPriorityRow(row, sources) ? first : rest).push(row);
  return { first, rest };
}

// Counts for the national map at the dashboard's default filters: every state,
// no source and no set-aside, deadlines inside MAP_PRESET_DAYS of `today`.
// soonByState is the "closing this week" note on that same map. Built from the
// full snapshot, so the first screen can draw the country without its rows.
export function mapPreset(rows, today, days = MAP_PRESET_DAYS, soonDays = MAP_SOON_DAYS) {
  const end = addISODays(today, days);
  const soonEnd = addISODays(today, soonDays);
  const byState = {};
  const soonByState = {};
  for (const row of rows) {
    const due = row[ROW.DUE];
    const state = row[ROW.STATE];
    if (!state || !due || due < today || due > end) continue;
    byState[state] = (byState[state] || 0) + 1;
    if (due <= soonEnd) soonByState[state] = (soonByState[state] || 0) + 1;
  }
  return { days, soonDays, today, byState, soonByState };
}

// A filtered view is already complete from the priority file when it cannot
// ask for a row that file left out. That is Florida, and the two local sources,
// at any deadline. A nationwide window is not: those rows arrive with the rest.
export function coveredByFirstPaint({ state = "", source = "", complete = false } = {}) {
  if (complete) return true;
  if (state === "FL") return true;
  if (FLORIDA_SOURCES.includes(source)) return true;
  return false;
}

// The preset is one map: the snapshot's own day, the default 30-day window,
// every source, no set-aside. Any other filter is a different map and waits.
export function mapPresetApplies({ days = 0, source = "", setaside = "", complete = false, snapshotToday = "", userToday = "", preset = null } = {}) {
  if (complete || !preset) return false;
  if (source || setaside) return false;
  if (Number(days) !== Number(preset.days)) return false;
  if (!snapshotToday || userToday !== snapshotToday || preset.today !== snapshotToday) return false;
  return true;
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
// is left unparsed. finish() parses it. The page does not pass openRest: the
// rest file is most of the bytes, so its download waits until finish(), after
// the first paint. A failed priority fetch throws. A rest file that does not
// match leaves the Florida rows in place. There is no fetch of data.json.
export async function loadSnapshot(fetchJson, openRest) {
  const restResponse = openRest ? Promise.resolve().then(openRest).then((r) => r, () => null) : null;
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
      return mergeSnapshot(priority, rest) || { meta: priority.meta, rows: priority.rows, complete: false };
    },
  };
}
