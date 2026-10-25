#!/usr/bin/env node
// Replace the Miami-Dade rows in data.json with the county's live solicitation feeds.
//
//   node scripts/build-miami-dade.js [--data data.json] [--today YYYY-MM-DD]
//
// Run after build-sam.js. If the county site fails, the previous county rows stay.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { decodeRow, encodeRows, tallyBySource } from "./sam-lib.js";
import { writeSplitFiles } from "./split-data.js";
import { MDC_CURRENT_URL, MDC_FUTURE_URL, currentToRow, futureToRow } from "./county-lib.js";
import { localISODate } from "../lib.js";

const { values: args } = parseArgs({ options: { data: { type: "string", default: "data.json" }, today: { type: "string" } } });
const today = args.today || localISODate();

// WHY a browser user agent: the county site's firewall rejects requests without one.
const HEADERS = { "User-Agent": "Mozilla/5.0 (govbid data refresh)", Accept: "application/json" };
async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${url} did not return a list`);
  return body;
}

const data = JSON.parse(readFileSync(args.data, "utf8"));
let current, future;
try {
  [current, future] = await Promise.all([getJson(MDC_CURRENT_URL), getJson(MDC_FUTURE_URL)]);
} catch (e) {
  console.error(`Miami-Dade feed unavailable (${e.message}); keeping the previous county rows.`);
  process.exit(0);
}

const fresh = [...current.map(currentToRow), ...future.map(futureToRow)].filter((r) => r.TITLE && r.DUE >= today);
const others = data.rows.map((r) => decodeRow(r, data.meta.dicts)).filter((r) => r.SRC !== "miami-dade");
const all = [...others, ...fresh];
const { rows, dicts } = encodeRows(all);
data.rows = rows;
data.meta = { ...data.meta, dicts, total: all.length, by_source: tallyBySource(all), county_built_at: new Date().toISOString() };
writeFileSync(args.data, JSON.stringify(data));
const split = writeSplitFiles(data, dirname(args.data));
console.log(`Miami-Dade: ${current.length} current and ${future.length} future solicitations, ${fresh.length} still open; ${all.length.toLocaleString()} rows total (${split.first.toLocaleString()} load first, ${split.rest.toLocaleString()} after).`);
