#!/usr/bin/env node
// One SMS-length digest: the top 3 new matches for a trade and county, plus
// one Florida renewal. No network calls. DRAFT and this text are for a person
// to read; nothing here contacts a buyer or writes a file.
//
//   node scripts/digest.js --trade painting --county Miami-Dade
//
// "New" is a posted date within NEW_DAYS of the snapshot day (data.meta.today,
// else the UTC date of meta.built_at). Still-open uses the day the digest is
// read, the same DUE >= today test as scripts/ask.js. Ranking is the ask.js
// order: the county, then South Florida, then the rest of Florida, then
// nationwide only when Florida has none. Renewals come from renewals.json
// through liveRenewals. Fewer than 3 matches, or no renewal, is said in the
// text. Nothing is invented to fill the message.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { decodeRow } from "./sam-lib.js";
import { localISODate, daysBetween, addDaysISO, stemMatcher, liveRenewals, TRADES } from "../lib.js";
import { countyOf, SOUTH_FLORIDA } from "../florida.js";
import { resolveTrade, resolveCounty, MAX_VALUE_CHARS } from "./commands.js";

// WHY 480: one SMS segment holds 160 characters, so three segments hold 480.
// That is the single-segment size. A joined message often keeps 153 characters
// of text per segment (the rest is the join header), which would be 459. The
// formatter stops at 480, which is the limit asked for; it has not been checked
// on a handset. Titles shrink to stay at or under it. Nothing is added to fill it.
export const SMS_MAX = 480;

// WHY 14: the contract file reaches back years, so "new" has to be a real
// window. 14 days ending on the snapshot day is long enough to name a few
// county bids when that county is active, and short enough that "new" is
// still true. The window is the snapshot's, not the clock's, so a later run
// describes the same file.
export const NEW_DAYS = 14;

// WHY 365: the renewals tab, the agent, and the pitch all treat "ending
// within a year" as the window a small firm can prepare for.
export const RENEWAL_DAYS = 365;

// WHY 3: ask.js prints 3 matches by default, and the digest promises that
// many. When the file has fewer, the text says how many there actually are.
const SHOW_COUNT = 3;

// WHY these widths: ids and the honest count stay; the title is what shrinks.
// Zero still leaves the due date and the id.
const TITLE_WIDTHS = [60, 40, 28, 16, 0];

// WHY 12: a shortened title breaks at the last space, unless that would leave
// fewer than 12 characters. A long first word is kept as cut.
const MIN_TITLE_CHARS = 12;

// WHY 40: renewal trade labels in renewals.json are short (the longest common
// one, "Commercial construction", is 24). A longer label is cut so it cannot
// spend the whole SMS.
const RENEWAL_LABEL_WIDTH = 40;

// WHY these indexes: renewals.json rows are arrays in the order app.js names
// R and pitch.js comments on: trade, end, amount, holder, agency, state,
// naics, description, id. This script does not import the browser page.
const RENEWAL_COL = { TRADE: 0, END: 1, STATE: 5, ID: 8 };

// WHY 40: contract ids in data.json are at most 32 characters and renewal ids
// in renewals.json are at most 17. Forty accepts both and rejects a sentence.
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

function ascii(s) {
  return String(s ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// WHY the calendar prefix: data.json stores POSTED as YYYY-MM-DD or as that
// date plus a clock time. The day is the first 10 characters either way.
function postedDay(value) {
  const day = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

// The day the file was built. "Posted in the last 14 days" is measured from
// this, so the SMS stays about the snapshot.
function snapshotDay(data, today) {
  const meta = data.meta || {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(meta.today)) return meta.today;
  const built = String(meta.built_at || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(built)) return built.slice(0, 10);
  return today;
}

function dateFromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  // WHY noon: local noon stays on that calendar day across a DST change.
  return new Date(y, m - 1, d, 12, 0, 0);
}

function safeId(id) {
  const s = ascii(id);
  return SAFE_ID.test(s) ? s : "";
}

function clip(raw) {
  const s = ascii(raw).slice(0, MAX_VALUE_CHARS);
  return s || "(blank)";
}

function rowsOf(data) {
  const dicts = data.meta?.dicts || {};
  return data.rows.map((r) => Array.isArray(r) ? decodeRow(r, dicts) : r);
}

// Same tier as scripts/ask.js: the named county, then South Florida, then
// the rest of Florida, then everywhere else.
function tierOf(r, county) {
  const place = r.STATE === "FL" ? countyOf(r.CITY, r.SRC) : "";
  if (place === county) return 0;
  if (SOUTH_FLORIDA.includes(place)) return 1;
  if (r.STATE === "FL") return 2;
  return 3;
}

function whereOf(r) {
  const place = r.STATE === "FL" ? countyOf(r.CITY, r.SRC) : "";
  if (place) return `${place} County`;
  const bits = [r.CITY, r.STATE].filter(Boolean).join(", ");
  return bits || "location not listed";
}

// One row per title, best tier then highest score, matching ask.js.
function dedupe(list, county) {
  const seen = new Set();
  return [...list]
    .sort((x, y) => tierOf(x, county) - tierOf(y, county) || (y.SCORE || 0) - (x.SCORE || 0))
    .filter((r) => !seen.has(r.TITLE) && seen.add(r.TITLE));
}

// The renewal file has no county. Match its trade label, not a description
// that merely uses the word: app.js filters on that label, and a paint booth
// filed under elevators is a different trade.
function pickRenewal(renewals, tradeHit, today) {
  const live = liveRenewals(renewals, RENEWAL_COL.END, today);
  const until = addDaysISO(RENEWAL_DAYS, dateFromISO(today));
  const fits = stemMatcher(tradeHit.stems);
  const hits = live.filter((r) => {
    if (!Array.isArray(r) || r[RENEWAL_COL.STATE] !== "FL") return false;
    const end = r[RENEWAL_COL.END];
    if (typeof end !== "string" || end > until) return false;
    if (!fits(String(r[RENEWAL_COL.TRADE] || "").toLowerCase())) return false;
    return safeId(r[RENEWAL_COL.ID]) !== "";
  });
  hits.sort((a, b) => String(a[RENEWAL_COL.END]).localeCompare(String(b[RENEWAL_COL.END]))
    || String(a[RENEWAL_COL.ID]).localeCompare(String(b[RENEWAL_COL.ID])));
  const top = hits[0];
  if (!top) return null;
  return { trade: String(top[RENEWAL_COL.TRADE]), end: top[RENEWAL_COL.END], id: safeId(top[RENEWAL_COL.ID]) };
}

function onlyLine(n) {
  if (n <= 0 || n >= SHOW_COUNT) return "";
  return `Only ${n} new ${n === 1 ? "match" : "matches"}, not ${SHOW_COUNT}.`;
}

function scopeSentence({ shown, totalNew, inCounty, county, nationwide }) {
  if (!totalNew) return "";
  const n = shown.length;
  if (nationwide) return `None in Florida; showing nationwide. ${n} of ${totalNew} new.`;
  if (!inCounty) return `None in ${county}; showing Florida. ${n} of ${totalNew} new.`;
  if (shown.every((m) => m.tier === 0)) return `${n} of ${totalNew} new in Florida (${inCounty} in ${county}).`;
  return `${n} of ${totalNew} new in Florida (${inCounty} in ${county}; others elsewhere in Florida).`;
}

function renewalLine(renewal, today) {
  if (!renewal) return `No Florida renewal for this trade within a year of ${today}.`;
  const label = ascii(renewal.trade).slice(0, RENEWAL_LABEL_WIDTH);
  // The renewal file stores a state, never a county. Say so in the same line.
  return `Renewal: ${label} in Florida ends ${renewal.end} id ${renewal.id}. No county on file.`;
}

function render({ trade, county, asOf, openNote, scope, shown, width, withWhere, renewalText }) {
  const head = `govbid ${trade} / ${county}. New=posted within ${NEW_DAYS}d of ${asOf} (snapshot day).${openNote}${scope ? " " + scope : ""}`;
  const lines = [head];
  if (!shown.length) lines.push("No new matches.");
  else {
    const only = onlyLine(shown.length);
    if (only) lines.push(only);
    shown.forEach((m, i) => {
      const full = ascii(m.title);
      let title = "";
      if (width && full) {
        if (full.length <= width) title = full;
        else {
          const cut = full.slice(0, width).trim();
          const space = cut.lastIndexOf(" ");
          title = space >= MIN_TITLE_CHARS ? cut.slice(0, space).trim() : cut;
        }
      }
      const where = withWhere ? ` in ${ascii(m.where)}` : "";
      const due = ascii(m.due) || "date not listed";
      lines.push(`${i + 1}. ${title ? title + " " : ""}due ${due}${where} id ${m.id}`);
    });
  }
  lines.push(renewalText);
  return lines.join("\n");
}

function formatDigest(info) {
  const openNote = info.today === info.asOf ? "" : ` Open as of ${info.today}.`;
  const scope = scopeSentence(info);
  const renewalText = renewalLine(info.renewal, info.today);
  // Place and title shrink first. The renewal line keeps "No county on file."
  for (const width of TITLE_WIDTHS) {
    for (const withWhere of [true, false]) {
      const text = render({ ...info, openNote, scope, width, withWhere, renewalText });
      if (text.length <= SMS_MAX && /^[\x0A\x20-\x7E]*$/.test(text)) return text;
    }
  }
  const bare = render({ ...info, openNote: "", scope: "", width: 0, withWhere: false, renewalText });
  if (bare.length <= SMS_MAX) return bare;
  throw new Error("digest exceeded the SMS length cap");
}

export function buildDigest({ trade, county, data, renewals, today } = {}) {
  const tradeHit = resolveTrade(trade);
  if (!tradeHit) {
    throw new Error(`Unknown trade "${clip(trade)}". Allowlist: ${TRADES.map((t) => t.id).join(", ")}.`);
  }
  const countyName = resolveCounty(county);
  if (!countyName) {
    throw new Error(`Unknown county "${clip(county)}". Use a Florida county name, such as Miami-Dade or Broward.`);
  }
  const todayDay = /^\d{4}-\d{2}-\d{2}$/.test(String(today || "")) ? String(today) : localISODate();
  if (!data || !Array.isArray(data.rows)) throw new Error("data.rows must be a list");
  if (!Array.isArray(renewals)) throw new Error("renewals must be a list");

  const asOf = snapshotDay(data, todayDay);
  const fits = stemMatcher(tradeHit.stems);
  const openNew = [];
  for (const r of rowsOf(data)) {
    if (!(r.DUE >= todayDay) || !r.US) continue;
    if (!fits(`${r.TITLE} ${r.SNIP}`.toLowerCase())) continue;
    const posted = postedDay(r.POSTED);
    if (!posted) continue;
    const age = daysBetween(posted, asOf);
    if (age < 0 || age > NEW_DAYS) continue;
    if (!safeId(r.ID)) continue;
    openNew.push(r);
  }

  const unique = dedupe(openNew, countyName);
  const florida = unique.filter((r) => tierOf(r, countyName) < 3);
  const nationwide = florida.length === 0 && unique.length > 0;
  const pool = florida.length ? florida : unique;
  const best = pool.slice(0, SHOW_COUNT);
  const shown = best.map((r) => ({
    title: r.TITLE, due: r.DUE, id: safeId(r.ID), tier: tierOf(r, countyName), where: whereOf(r),
  }));
  return formatDigest({
    trade: ascii(tradeHit.label),
    county: countyName,
    asOf,
    today: todayDay,
    shown,
    totalNew: pool.length,
    inCounty: pool.filter((r) => tierOf(r, countyName) === 0).length,
    nationwide,
    renewal: pickRenewal(renewals, tradeHit, todayDay),
  });
}

export function main(argv = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        trade: { type: "string" },
        county: { type: "string" },
        data: { type: "string", default: new URL("../data.json", import.meta.url).pathname },
        renewals: { type: "string", default: new URL("../renewals.json", import.meta.url).pathname },
        today: { type: "string" },
      },
    }));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (!values.trade || !values.county) {
    console.error("Usage: node scripts/digest.js --trade <trade> --county <county>");
    return 1;
  }
  try {
    const data = JSON.parse(readFileSync(values.data, "utf8"));
    const renewals = JSON.parse(readFileSync(values.renewals, "utf8"));
    console.log(buildDigest({ trade: values.trade, county: values.county, data, renewals, today: values.today }));
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) process.exit(main());
