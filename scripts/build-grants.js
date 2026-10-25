#!/usr/bin/env node
// Build grants.json: federal grants open to small businesses, nonprofits and
// individuals, plus Grants.gov "Unrestricted" (any applicant) and "Others"
// (eligibility is in the listing text), from the Grants.gov public API.
//
//   node scripts/build-grants.js [--out grants.json] [--today YYYY-MM-DD]
import { writeFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { SEARCH_URL, DETAIL_URL, ELIGIBILITY, toGrant, stillOpen } from "./grants-lib.js";
import { localISODate } from "../lib.js";

const { values: args } = parseArgs({ options: { out: { type: "string", default: "grants.json" }, today: { type: "string" } } });
const today = args.today || localISODate();

// WHY 6 at a time with a timeout: about a thousand detail calls finish in a minute
// or two without hammering a public government API.
const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;
// WHY 5000: larger than any single eligibility's hit count (about 1,100 for
// "Others" on 2026-10-25; the next largest is under 900), so one request
// returns every grant for that applicant type.
const ROWS = 5000;

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const json = await res.json();
  if (json.errorcode !== 0) throw new Error(`${url}: ${json.msg}`);
  return json.data;
}

// 1. Who may apply to what.
const hits = new Map(), eligible = new Map();
for (const [code, group] of Object.entries(ELIGIBILITY)) {
  const data = await post(SEARCH_URL, { rows: ROWS, oppStatuses: "forecasted|posted", eligibilities: code });
  for (const h of data.oppHits || []) {
    hits.set(String(h.id), h);
    eligible.set(String(h.id), [...(eligible.get(String(h.id)) || []), group]);
  }
}
const ids = [...hits.keys()];

// 2. Details: award size, description, categories, contact.
const details = new Map();
let failed = 0;
for (let i = 0; i < ids.length; i += CONCURRENCY) {
  await Promise.all(ids.slice(i, i + CONCURRENCY).map(async (id) => {
    try { details.set(id, await post(DETAIL_URL, { opportunityId: Number(id) })); } catch { failed++; }
  }));
}

const grants = ids.map((id) => toGrant(hits.get(id), eligible.get(id), details.get(id))).filter((g) => stillOpen(g, today))
  .sort((a, b) => (a.closes || "9999").localeCompare(b.closes || "9999"));
// A partial run beats none, but a run where most details failed is a broken API day.
if (!grants.length || failed > ids.length / 2) {
  console.error(`Grants.gov returned too little (${grants.length} grants, ${failed} detail failures); not writing ${args.out}.`);
  process.exit(existsSync(args.out) ? 0 : 1);
}
writeFileSync(args.out, JSON.stringify({ built_at: new Date().toISOString(), today, grants }));
console.log(`Grants: ${grants.length} open or forecast (${failed} without details) written to ${args.out}.`);
