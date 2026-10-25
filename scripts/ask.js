#!/usr/bin/env node
// Answer one request from the live data, in text short enough for an SMS reply.
// Used by the Google Doc relay: someone texts their personal agent (e.g. Instinct),
// it writes the request into a shared doc, and a scheduled job runs this and writes
// the answer back.
//
//   node scripts/ask.js --trade "painting" [--county Miami-Dade] [--who small_business] [--limit 3]
//   node scripts/ask.js --parse <file>     or    --parse -     to read stdin
// --parse prints validated portal commands as JSON and does not search.
// It is not wired into the relay. DRAFT in that JSON is a draft for a person
// to approve; this script never sends it.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { F, decodeRow } from "./sam-lib.js";
import { localISODate, daysBetween, stemMatcher, filterGrants, TRADES } from "../lib.js";
import { countyOf, SOUTH_FLORIDA } from "../florida.js";
import { parseCommands } from "./commands.js";

const { values: a } = parseArgs({ options: {
  trade: { type: "string", default: "" }, county: { type: "string", default: "Miami-Dade" },
  who: { type: "string", default: "small_business" }, limit: { type: "string", default: "3" },
  data: { type: "string", default: new URL("../data.json", import.meta.url).pathname },
  grants: { type: "string", default: new URL("../grants.json", import.meta.url).pathname },
  parse: { type: "string" },
} });

// Only the new flag takes this branch. Current flags fall through unchanged.
if (a.parse !== undefined) {
  try {
    if (a.parse === "") throw new Error("Usage: node scripts/ask.js --parse <file> or --parse -");
    const text = a.parse === "-" ? readFileSync(0, "utf8") : readFileSync(a.parse, "utf8");
    let data;
    try { data = JSON.parse(readFileSync(a.data, "utf8")); }
    catch (err) { throw new Error(`Could not read contract data: ${err instanceof Error ? err.message : String(err)}`); }
    console.log(JSON.stringify(parseCommands(text, { data }), null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

// A trade name from the quiz list maps to its stems; anything else is used as typed.
const words = a.trade.toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean);
const stems = words.flatMap((w) => TRADES.find((t) => t.id === w || t.label.toLowerCase().startsWith(w))?.stems || [w]);
if (!stems.length) { console.log("Tell me the kind of work, e.g. painting, janitorial, HVAC, catering."); process.exit(0); }

const today = localISODate();
const fits = stemMatcher(stems);
const limit = Math.max(1, Math.min(5, Number(a.limit) || 3));
const data = JSON.parse(readFileSync(a.data, "utf8"));
const rows = data.rows.map((r) => decodeRow(r, data.meta.dicts))
  .filter((r) => r.DUE >= today && r.US && fits(`${r.TITLE} ${r.SNIP}`.toLowerCase()));

// Their county first, then South Florida, then the rest of Florida.
const place = (r) => r.STATE === "FL" ? countyOf(r.CITY, r.SRC) : "";
const tier = (r) => place(r) === a.county ? 0 : SOUTH_FLORIDA.includes(place(r)) ? 1 : r.STATE === "FL" ? 2 : 3;
const inFlorida = rows.filter((r) => tier(r) < 3);
// Nothing in Florida: fall back to the best nationwide matches rather than a dead end.
const pool = inFlorida.length ? inFlorida : rows;
// One line per title: re-posts and amendments repeat.
const seen = new Set();
const best = [...pool].sort((x, y) => tier(x) - tier(y) || (y.SCORE || 0) - (x.SCORE || 0))
  .filter((r) => !seen.has(r.TITLE) && seen.add(r.TITLE)).slice(0, limit);

const lines = [`govbid: ${inFlorida.length} open in Florida for "${a.trade}" (${rows.filter((r) => tier(r) === 0).length} in ${a.county})${inFlorida.length ? "." : `. Best nationwide (${rows.length} open):`}`];
best.forEach((r, i) => {
  const d = daysBetween(today, r.DUE);
  const where = place(r) ? `${place(r)} County` : [r.CITY, r.STATE].filter(Boolean).join(", ") || "location not listed";
  const due = d <= 0 ? "due today" : `due in ${d} day${d === 1 ? "" : "s"}`;
  lines.push(`${i + 1}. ${r.TITLE.slice(0, 80)} (${where}), ${due}. ${r.LINK}${r.EMAIL ? ` Buyer: ${r.EMAIL}` : ""}`);
});
if (!best.length) lines.push("Nothing open for that trade right now. Try a related trade.");

try {
  const g = filterGrants(JSON.parse(readFileSync(a.grants, "utf8")).grants, { who: a.who, today }).filter((x) => fits(`${x.title} ${x.desc}`.toLowerCase()));
  if (g.length) lines.push(`Grant: ${g[0].title.slice(0, 70)}${g[0].closes ? `, closes ${g[0].closes}` : ""}. ${g[0].link}`);
} catch { /* grants.json missing: contracts only */ }
lines.push("Free help: Florida APEX Accelerator at FIU.");
console.log(lines.join("\n"));
