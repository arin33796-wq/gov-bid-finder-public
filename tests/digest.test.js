import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeRows } from "../scripts/sam-lib.js";
import { buildDigest, SMS_MAX, NEW_DAYS } from "../scripts/digest.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddd";
const TODAY = "2026-10-25";

function row(over) {
  return {
    ID: A, TITLE: "Paint the lobby", DEPT: "GSA", TYPE: "Solicitation", SA: "",
    DUE: "2026-11-01", NAICS: "238320", STATE: "FL", CITY: "Miami",
    LINK: "https://example.test/a", SRC: "sam.gov", SNIP: "interior painting",
    POSTED: "2026-10-20", SUBTIER: "", CONTACT: "", EMAIL: "", CNAME: "",
    SCORE: 10, SIMP: 50, VALUE: null, BENCH: 0, US: 1,
    ...over,
  };
}

function pack(objs, meta = {}) {
  const { rows, dicts } = encodeRows(objs);
  return { meta: { today: TODAY, built_at: "2026-10-25T12:00:00.000Z", dicts, ...meta }, rows };
}

const baseRenewals = [
  ["Painting", "2026-12-01", 1000, "ACME", "VA", "FL", "238320", "exterior paint", "PAINTFL1"],
  ["Elevators & building equipment", "2026-11-01", 1000, "ACME", "VA", "FL", "238320", "INSTALL PAINT BOOTH", "ELEVATOR1"],
  ["Painting", "2026-11-15", 1, "X", "VA", "GA", "238320", "paint", "GAPAINT"],
  ["Painting", "2026-10-24", 1, "X", "VA", "FL", "238320", "paint", "ENDED"],
  ["Painting", "2027-10-26", 1, "X", "VA", "FL", "238320", "paint", "TOOLATE"],
  ["Painting", "2027-10-25", 1, "X", "VA", "FL", "238320", "paint", "EDGE"],
];

test("formats the top new matches, keeps the county first, and names one renewal", () => {
  const data = pack([
    row({ ID: A, TITLE: "Paint the lobby", CITY: "Miami", SCORE: 10 }),
    row({ ID: B, TITLE: "Paint the port", CITY: "Tampa", STATE: "FL", SCORE: 90 }),
    row({ ID: C, TITLE: "Paint the hangar", CITY: "Atlanta", STATE: "GA", SCORE: 99, SNIP: "painting" }),
    row({ ID: D, TITLE: "Paint the archive", CITY: "Miami", POSTED: "2020-01-01", SCORE: 100 }),
    row({ ID: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", TITLE: "Paint closed", DUE: "2026-10-24", SCORE: 100 }),
    row({ ID: "ffffffffffffffffffffffffffffffff", TITLE: "Ship paint", US: 0, SCORE: 100, STATE: "XX", CITY: "Nowhere" }),
  ]);
  const text = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals: baseRenewals, today: TODAY });
  assert.equal(text, [
    "govbid Painting / Miami-Dade. New=posted within 14d of 2026-10-25 (snapshot day). 2 of 2 new in Florida (1 in Miami-Dade; others elsewhere in Florida).",
    "Only 2 new matches, not 3.",
    "1. Paint the lobby due 2026-11-01 in Miami-Dade County id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "2. Paint the port due 2026-11-01 in Hillsborough County id bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "Renewal: Painting in Florida ends 2026-12-01 id PAINTFL1. No county on file.",
  ].join("\n"));
  assert.ok(text.length <= SMS_MAX);
  assert.equal(NEW_DAYS, 14);
  assert.doesNotMatch(text, /hangar|archive|closed|Ship paint|ELEVATOR1|GAPAINT|ENDED|TOOLATE|EDGE|Example/);
});

test("a posted clock time counts as that calendar day, and the window is the snapshot", () => {
  const data = pack([
    row({ ID: A, TITLE: "Paint on time", POSTED: "2026-10-11 16:44:33" }),
    row({ ID: B, TITLE: "Paint too old", POSTED: "2026-10-10" }),
    row({ ID: C, TITLE: "Paint after the snapshot", POSTED: "2026-10-26", DUE: "2026-12-01" }),
  ]);
  const text = buildDigest({ trade: "Painting", county: "miami dade", data, renewals: [], today: TODAY });
  assert.match(text, /Paint on time/);
  assert.doesNotMatch(text, /too old|after the snapshot/);
  assert.match(text, /Only 1 new match, not 3\./);
  assert.match(text, /No Florida renewal for this trade within a year of 2026-10-25\./);
});

test("an empty file says so and does not invent a match or a renewal", () => {
  const text = buildDigest({ trade: "food", county: "Broward", data: pack([]), renewals: [], today: TODAY });
  assert.equal(text, [
    "govbid Food & catering / Broward. New=posted within 14d of 2026-10-25 (snapshot day).",
    "No new matches.",
    "No Florida renewal for this trade within a year of 2026-10-25.",
  ].join("\n"));
  assert.doesNotMatch(text, /^\d+\. /m);
  assert.doesNotMatch(text, /Example/);
  assert.ok(text.length <= SMS_MAX);
});

test("huge titles stay inside the SMS cap and the ids survive", () => {
  const long = "Paint " + "word ".repeat(400);
  const data = pack([
    row({ ID: A, TITLE: long + "one", SCORE: 10 }),
    row({ ID: B, TITLE: long + "two", CITY: "Miami", SCORE: 20 }),
    row({ ID: C, TITLE: long + "three", CITY: "Miami", SCORE: 30 }),
  ]);
  const renewals = [["Painting", "2026-12-01", 1, "ACME", "VA", "FL", "238320", "x", "PAINTFL1"]];
  const text = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals, today: TODAY });
  assert.ok(text.length <= SMS_MAX, String(text.length));
  assert.match(text, /id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(text, /id bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(text, /id cccccccccccccccccccccccccccccccc/);
  assert.match(text, /id PAINTFL1/);
  // The cap shortens the title. The full 2,000-character title is not sent.
  assert.equal(text.includes(long.slice(0, 200)), false);
  assert.match(text, /^[\x0A\x20-\x7E]*$/);
});

test("a deadline that has passed drops out, and a different read-day is labeled", () => {
  const data = pack([
    row({ ID: A, TITLE: "Paint still open", DUE: "2026-11-01", POSTED: "2026-10-20" }),
    row({ ID: B, TITLE: "Paint just closed", DUE: "2026-10-26", POSTED: "2026-10-20" }),
  ]);
  const text = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals: [], today: "2026-10-28" });
  assert.match(text, /Open as of 2026-10-28/);
  assert.match(text, /Paint still open/);
  assert.doesNotMatch(text, /just closed/);
  assert.match(text, /New=posted within 14d of 2026-10-25/);
});

test("with no meta.today, the window uses built_at", () => {
  const { rows, dicts } = encodeRows([row({ TITLE: "Paint from the build", POSTED: "2026-10-20" })]);
  const data = { meta: { built_at: "2026-10-25T13:14:17.610Z", dicts }, rows };
  const text = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals: [], today: TODAY });
  assert.match(text, /2026-10-25 \(snapshot day\)/);
  assert.match(text, /Paint from the build/);
});

test("unknown trade or county is refused, with no invented digest", () => {
  const data = pack([row({})]);
  assert.throws(() => buildDigest({ trade: "painting; rm", county: "Miami-Dade", data, renewals: [], today: TODAY }), /Unknown trade/);
  assert.throws(() => buildDigest({ trade: "painting", county: "outside", data, renewals: [], today: TODAY }), /Unknown county/);
  assert.throws(() => buildDigest({ trade: "painting", county: "Miami-Dade", data: {}, renewals: [], today: TODAY }), /data\.rows/);
});

test("a description-only renewal is not used when the trade label does not match", () => {
  const data = pack([]);
  const renewals = [
    ["Elevators & building equipment", "2026-11-01", 1, "ACME", "Navy", "FL", "238320", "GENERATORS - CONSTRUCTION", "ELEV1"],
    ["Commercial construction", "2026-11-28", 1, "ACME", "GSA", "FL", "238320", "DESIGN-BUILD", "CONST1"],
  ];
  const text = buildDigest({ trade: "construction", county: "Miami-Dade", data, renewals, today: TODAY });
  assert.match(text, /No new matches\./);
  assert.match(text, /id CONST1/);
  assert.doesNotMatch(text, /ELEV1/);
});

test("nationwide matches are labeled nationwide when Florida has none", () => {
  const data = pack([
    row({ ID: A, TITLE: "Paint the hangar", STATE: "NC", CITY: "Elizabeth City", SCORE: 40 }),
  ]);
  const text = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals: [], today: TODAY });
  assert.match(text, /None in Florida; showing nationwide\. 1 of 1 new\./);
  assert.match(text, /in Elizabeth City, NC id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(text, /Only 1 new match, not 3\./);
});

test("the CLI prints the digest and refuses a trade that is not on the list", () => {
  const dir = mkdtempSync(join(tmpdir(), "govbid-digest-"));
  try {
    const data = pack([row({})]);
    const dataPath = join(dir, "data.json");
    const renewalsPath = join(dir, "renewals.json");
    writeFileSync(dataPath, JSON.stringify(data));
    writeFileSync(renewalsPath, JSON.stringify(baseRenewals));
    const cwd = new URL("..", import.meta.url).pathname;
    const ok = spawnSync(process.execPath, ["scripts/digest.js", "--trade", "painting", "--county", "Miami-Dade", "--data", dataPath, "--renewals", renewalsPath, "--today", TODAY], { encoding: "utf8", cwd });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stderr, "");
    const expected = buildDigest({ trade: "painting", county: "Miami-Dade", data, renewals: baseRenewals, today: TODAY });
    assert.equal(ok.stdout, expected + "\n");
    assert.ok(ok.stdout.length <= SMS_MAX + 1);

    const bad = spawnSync(process.execPath, ["scripts/digest.js", "--trade", "nope", "--county", "Miami-Dade", "--data", dataPath, "--renewals", renewalsPath], { encoding: "utf8", cwd });
    assert.notEqual(bad.status, 0);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /Unknown trade/);

    const usage = spawnSync(process.execPath, ["scripts/digest.js"], { encoding: "utf8", cwd });
    assert.notEqual(usage.status, 0);
    assert.match(usage.stderr, /Usage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the digest module does not call the network or write a file", () => {
  const src = readFileSync(new URL("../scripts/digest.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(|node:http|node:net|child_process|writeFile/);
});

test("the real snapshot stays within 480 characters for construction and painting in Miami-Dade", () => {
  const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8"));
  const renewals = JSON.parse(readFileSync(new URL("../renewals.json", import.meta.url), "utf8"));
  for (const trade of ["construction", "painting"]) {
    const text = buildDigest({ trade, county: "Miami-Dade", data, renewals, today: TODAY });
    assert.ok(text.length > 0 && text.length <= SMS_MAX, `${trade} length ${text.length}`);
    assert.match(text, /New=posted within 14d of 2026-10-25 \(snapshot day\)/);
    assert.match(text, /Miami-Dade/);
    assert.doesNotMatch(text, /Example/);
    assert.match(text, /^[\x0A\x20-\x7E]*$/);
    const lines = text.split("\n");
    const nums = lines.filter((l) => /^\d+\. /.test(l));
    assert.ok(nums.length <= 3);
    if (!nums.length) assert.match(text, /No new matches\./);
    if (nums.length > 0 && nums.length < 3) assert.match(text, new RegExp(`Only ${nums.length} new match`));
    const renewal = lines.find((l) => l.startsWith("Renewal:") || l.startsWith("No Florida renewal"));
    assert.ok(renewal, trade);
    if (renewal.startsWith("Renewal:")) assert.doesNotMatch(renewal, /Miami-Dade/);
  }
});
