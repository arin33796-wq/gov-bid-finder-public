#!/usr/bin/env node
// Rebuild the federal part of data.json from the SAM.gov public extract.
//
//   node scripts/build-sam.js --csv ContractOpportunitiesFullCSV.csv [--data data.json] [--today YYYY-MM-DD]
//
// Federal rows are rebuilt from scratch. State of Florida and Miami-Dade rows come
// from feeds this repo does not have, so they are carried over from the previous
// snapshot while still open. Award history (value benchmarks, awards_by_month,
// NAICS names) is carried over too: it changes slowly and comes from USAspending.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { F, CsvParser, cleanText, deadlineDate, isUS, simplicity, score, decodeRow, encodeRows, tallyBySource } from "./sam-lib.js";
import { writeSplitFiles } from "./split-data.js";
import { localISODate } from "../lib.js";

const { values: args } = parseArgs({ options: {
  csv: { type: "string" }, data: { type: "string", default: "data.json" }, today: { type: "string" },
} });
if (!args.csv) { console.error("usage: build-sam.js --csv <ContractOpportunitiesFullCSV.csv> [--data data.json]"); process.exit(2); }
const today = args.today || localISODate();

// WHY 260: matches the snippet length of the original snapshot; enough for two
// lines on a card while keeping data.json near 10 MB.
const SNIPPET_CHARS = 260;

const prev = JSON.parse(readFileSync(args.data, "utf8"));
const pd = prev.meta.dicts;

// Value benchmarks per industry code: [typical award, number of awards behind it].
// Stored in meta from now on; the first run recovers them from the previous rows.
const bench = { ...(prev.meta.naics_bench || {}) };
for (const r of prev.rows) if (pd.sources[r[F.SRC]] === "sam.gov" && r[F.NAICS] && !(r[F.NAICS] in bench)) bench[r[F.NAICS]] = [r[F.VALUE], r[F.BENCH]];

const carried = prev.rows.map((r) => decodeRow(r, pd)).filter((r) => r.SRC !== "sam.gov" && r.DUE >= today);

// ---- read the extract ----
const fresh = new Map();
let header = null, seen = 0;
const col = {};
function take(rec) {
  if (!header) { header = rec; header.forEach((h, i) => { col[h] = i; }); return; }
  seen++;
  const g = (name) => rec[col[name]] ?? "";
  if (g("Active") !== "Yes") return;
  const due = deadlineDate(g("ResponseDeadLine"));
  if (!due || due < today) return;
  const id = g("NoticeId");
  const prior = fresh.get(id);
  if (prior && prior.POSTED >= g("PostedDate")) return;   // keep the latest amendment
  const title = cleanText(g("Title"));
  const desc = cleanText(g("Description"));
  const naics = g("NaicsCode").trim();
  const [value, nAwards] = bench[naics] || [null, 0];
  const type = g("Type");
  const simp = simplicity({ type, title, desc });
  const name = g("PrimaryContactFullname").trim(), email = g("PrimaryContactEmail").trim();
  fresh.set(id, {
    ID: id, TITLE: title, DEPT: g("Department/Ind.Agency"), TYPE: type, SA: g("SetASide"), DUE: due,
    NAICS: naics, STATE: g("PopState"), CITY: g("PopCity"), LINK: g("Link") || `https://sam.gov/workspace/contract/opp/${id}/view`,
    SRC: "sam.gov", SNIP: desc.slice(0, SNIPPET_CHARS), POSTED: g("PostedDate"), SUBTIER: g("Sub-Tier"),
    CONTACT: [name, email].filter(Boolean).join(" · "), EMAIL: email, CNAME: name,
    SCORE: score(value, simp), SIMP: simp, VALUE: value, BENCH: nAwards,
    US: isUS(g("PopCountry"), g("CountryCode")) ? 1 : 0,
  });
}

// WHY windows-1252: the extract is not UTF-8. Decoding it as UTF-8 is what turned
// curly quotes and dashes into U+FFFD in the original snapshot.
const decoder = new TextDecoder("windows-1252");
const parser = new CsvParser();
for await (const chunk of createReadStream(args.csv)) for (const rec of parser.push(decoder.decode(chunk, { stream: true }))) take(rec);
for (const rec of parser.push(decoder.decode())) take(rec);
for (const rec of parser.end()) take(rec);
if (!header || !("NoticeId" in col) || !("ResponseDeadLine" in col)) { console.error("Not a SAM.gov opportunities extract: missing NoticeId/ResponseDeadLine columns."); process.exit(1); }

// ---- encode ----
const all = [...fresh.values(), ...carried];
const { rows: encoded, dicts } = encodeRows(all);
const out = {
  meta: {
    ...prev.meta,
    built_at: new Date().toISOString(), today, total: all.length, by_source: tallyBySource(all), dicts,
    naics_bench: bench,
  },
  rows: encoded,
};
writeFileSync(args.data, JSON.stringify(out));
const split = writeSplitFiles(out, dirname(args.data));
console.log(`Read ${seen.toLocaleString()} notices; ${fresh.size.toLocaleString()} federal open as of ${today}; carried ${carried.length} state/county rows; wrote ${all.length.toLocaleString()} rows to ${args.data} (${split.first.toLocaleString()} load first, ${split.rest.toLocaleString()} after).`);
