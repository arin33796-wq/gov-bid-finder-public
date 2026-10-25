// Portal commands a person (or their personal agent) may append to the relay
// doc. The doc is untrusted. This module only recognizes four uppercase
// commands and returns plain JSON. It does not eval, search the network,
// read or write files, send mail, or submit a bid.
//
//   PROFILE: trade=painting; county=Miami-Dade; who=small_business
//   PROFILE: painting in Miami-Dade for small business
//   SAVE: <contract id>
//   DRAFT: <contract id>
//   DIGEST: painting in Miami-Dade
//
// DRAFT names a contract to draft paperwork for. A person reviews it and
// sends it themselves. Nothing here contacts a buyer.
import { TRADES, CERTS } from "../lib.js";
import { FL_COUNTIES } from "../florida.js";
import { ELIGIBILITY } from "./grants-lib.js";

// WHY 400: a PROFILE that sets every quiz field is under 250 characters.
// Anything longer is not a command; it is rejected whole so a real command
// cannot be hidden after a paragraph of instructions.
export const MAX_LINE_CHARS = 400;

// WHY 20000: the relay doc is a short shared note. A larger payload is
// refused whole, rather than parsed up to a cut, so a truncated line cannot
// turn into a different command.
export const MAX_INPUT_CHARS = 20000;

// WHY 80: the ignored list is for a person. Echoing a whole hostile line
// would copy it into the answer; 80 characters is enough to recognize it.
export const MAX_ECHO = 80;

// WHY 80: the longest free-text value the quiz stores is "other", which
// portal.js already caps at 80 characters. No command value needs more.
export const MAX_VALUE_CHARS = 80;

// WHY 32: every contract id in data.json is at most this long. The longest
// is a 32-character SAM.gov NoticeId. A longer token cannot be one of ours.
export const MAX_ID_CHARS = 32;

// WHY these shapes: they are the id families actually stored in data.json.
// 32 hex is a SAM.gov NoticeId. mdc- / mdcf- plus 12 hex is the Miami-Dade
// short hash from county-lib.js. mfmp- plus 8 hex, or mfmp- plus
// ITB/ITN/RFP/RFI and a solicitation token plus 8 hex, is a
// MyFloridaMarketplace id. tests/commands.test.js checks every id in the
// snapshot against this pattern.
export const CONTRACT_ID_RE = /^(?:[0-9a-f]{32}|mdc[f]?-[0-9a-f]{12}|mfmp-[0-9a-f]{8}|mfmp-(?:ITB|ITN|RFP|RFI)-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9a-f]{8})$/;

// WHY: these are the Grants.gov applicant types grants-lib.js already maps
// (ELIGIBILITY) and the values ask.js passes as --who.
const WHO = new Set(Object.values(ELIGIBILITY));

// WHY these three: the welcome quiz's radios in index.html (name=q-kind).
const KINDS = new Set(["business", "nonprofit", "exploring"]);

// WHY this map: kind and who are the same fact for the two kinds that apply.
// "exploring" is not an applicant type, so it may sit beside any who.
const KIND_WHO = { business: "small_business", nonprofit: "nonprofit" };

// WHY these four: the quiz's team-size options in index.html (#q-size).
const SIZES = new Set(["1-5", "6-20", "21-100", "100+"]);

// WHY these four: the quiz's largest-job options in index.html (#q-maxjob).
const MAX_JOBS = new Set(["25000", "100000", "500000", "2000000"]);

// WHY: only these keys are copied onto a result. User keys are never assigned
// onto an object, so __proto__ or constructor cannot change the prototype.
const PROFILE_KEYS = new Set(["trade", "county", "who", "kind", "certs", "size", "maxJob", "other"]);
const DIGEST_KEYS = new Set(["trade", "county"]);
const KEY_ALIAS = {
  trade: "trade", county: "county", who: "who", kind: "kind", certs: "certs",
  size: "size", maxjob: "maxJob", other: "other",
};

// WHY: letters, digits, and the punctuation the quiz would accept in a short
// "what else do you do" answer. Angle brackets, backticks, and quotes are
// left out so the value cannot carry a tag or a shell snippet.
const OTHER_RE = /^[A-Za-z0-9][A-Za-z0-9 &'.,/-]{0,79}$/;

const COUNTY_BY_KEY = new Map(Object.keys(FL_COUNTIES).map((name) => [countyKey(name), name]));

function countyKey(s) {
  return String(s).toLowerCase().replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

export function isContractId(id) {
  return typeof id === "string" && id.length <= MAX_ID_CHARS && CONTRACT_ID_RE.test(id);
}

export function resolveTrade(raw) {
  const w = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!w || w.length > MAX_VALUE_CHARS) return null;
  return TRADES.find((t) => t.id === w || t.label.toLowerCase() === w) || null;
}

// allowOutside is only for PROFILE, where the quiz offers "Outside Florida".
export function resolveCounty(raw, { allowOutside = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text || text.length > MAX_VALUE_CHARS) return null;
  if (allowOutside && /^outside$/i.test(text)) return "outside";
  return COUNTY_BY_KEY.get(countyKey(text)) || null;
}

export function resolveWho(raw) {
  let text = String(raw ?? "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  text = text.replace(/^an?\s+/, "");
  if (!text || text.length > MAX_VALUE_CHARS) return null;
  const key = text.replace(/ /g, "_");
  if (key === "non_profit") return "nonprofit";
  if (key === "smallbusiness") return "small_business";
  return WHO.has(key) ? key : null;
}

function echo(line) {
  return String(line).replace(/[\x00-\x1F\x7F]/g, "").slice(0, MAX_ECHO);
}

function idSet(data) {
  if (data === undefined) return undefined;
  if (!data || typeof data !== "object" || !Array.isArray(data.rows)) return null;
  const set = new Set();
  for (const row of data.rows) {
    const id = Array.isArray(row) ? row[0] : row && typeof row.ID === "string" ? row.ID : "";
    if (typeof id === "string" && id) set.add(id);
  }
  return set;
}

function parsePairs(payload) {
  const parts = payload.split(";").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: "missing fields" };
  const out = Object.create(null);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) return { error: "expected key=value pairs separated by semicolons" };
    const rawKey = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(rawKey)) return { error: "bad field name" };
    const canon = KEY_ALIAS[rawKey.toLowerCase()];
    if (!canon) return { error: `unknown field ${rawKey.slice(0, 40)}` };
    if (Object.prototype.hasOwnProperty.call(out, canon)) return { error: `repeated field ${canon}` };
    if (value.length > MAX_VALUE_CHARS) return { error: `${canon} is too long` };
    if (/[\x00-\x1F\x7F]/.test(value)) return { error: "control characters" };
    out[canon] = value;
  }
  return { pairs: out };
}

function phrasePairs(cmd, payload) {
  if (cmd === "DIGEST") {
    const m = /^(.+?)\s+in\s+(.+)$/i.exec(payload);
    if (!m) return { error: 'expected "<trade> in <county>"' };
    return { pairs: { trade: m[1].trim(), county: m[2].trim() } };
  }
  const m = /^(.+?)\s+in\s+(.+?)\s+(?:for|who)\s+(.+)$/i.exec(payload);
  if (!m) return { error: 'expected "<trade> in <county> for <who>"' };
  return { pairs: { trade: m[1].trim(), county: m[2].trim(), who: m[3].trim() } };
}

function buildProfile(pairs) {
  for (const key of Object.keys(pairs)) {
    if (!PROFILE_KEYS.has(key)) return { reason: `unknown field ${key}` };
  }
  if (!pairs.trade || !pairs.county || !pairs.who) return { reason: "profile needs trade, county, and who" };
  const trade = resolveTrade(pairs.trade);
  if (!trade) return { reason: "trade is not on the quiz list" };
  const county = resolveCounty(pairs.county, { allowOutside: true });
  if (!county) return { reason: "county is not a Florida county or outside" };
  const who = resolveWho(pairs.who);
  if (!who) return { reason: "who is not an allowlisted applicant type" };
  const cmd = { cmd: "profile", trade: trade.id, county, who };
  if (pairs.kind !== undefined) {
    const kind = String(pairs.kind).toLowerCase();
    if (!KINDS.has(kind)) return { reason: "kind is not on the quiz list" };
    if (KIND_WHO[kind] && KIND_WHO[kind] !== who) return { reason: "kind does not match who" };
    cmd.kind = kind;
  }
  if (pairs.certs !== undefined) {
    const ids = String(pairs.certs).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!ids.length) return { reason: "certs is empty" };
    const known = new Set(CERTS.map((c) => c.id));
    if (ids.some((id) => !known.has(id))) return { reason: "certs has a value off the quiz list" };
    cmd.certs = [...new Set(ids)];
  }
  if (pairs.size !== undefined) {
    if (!SIZES.has(pairs.size)) return { reason: "size is not on the quiz list" };
    cmd.size = pairs.size;
  }
  if (pairs.maxJob !== undefined) {
    if (!MAX_JOBS.has(pairs.maxJob)) return { reason: "maxJob is not on the quiz list" };
    cmd.maxJob = pairs.maxJob;
  }
  if (pairs.other !== undefined) {
    if (!OTHER_RE.test(pairs.other)) return { reason: "other has characters the quiz does not store" };
    cmd.other = pairs.other;
  }
  return { command: cmd };
}

function buildDigest(pairs) {
  for (const key of Object.keys(pairs)) {
    if (!DIGEST_KEYS.has(key)) return { reason: "digest only accepts trade and county" };
  }
  if (!pairs.trade || !pairs.county) return { reason: "digest needs trade and county" };
  const trade = resolveTrade(pairs.trade);
  if (!trade) return { reason: "trade is not on the quiz list" };
  const county = resolveCounty(pairs.county);
  if (!county) return { reason: "county is not a Florida county" };
  return { command: { cmd: "digest", trade: trade.id, county } };
}

function parseFields(cmd, payload) {
  const body = payload.trim();
  if (!body) return { reason: "missing fields" };
  const parsed = body.includes("=") ? parsePairs(body) : phrasePairs(cmd, body);
  if (parsed.error) return { reason: parsed.error };
  return cmd === "DIGEST" ? buildDigest(parsed.pairs) : buildProfile(parsed.pairs);
}

function parseIdCommand(cmd, payload, known) {
  const id = payload.trim();
  if (!id) return { reason: "missing contract id" };
  if (/\s/.test(id) || id.includes(";") || id.includes("=") || id.includes("`") || id.includes("$")) {
    return { reason: "contract id must be a single token" };
  }
  if (!isContractId(id)) return { reason: "contract id does not match a known format" };
  if (known === null) return { reason: "contract list is missing" };
  if (known && !known.has(id)) return { reason: "contract id is not in the data" };
  return { command: { cmd, id } };
}

function parseLine(line, known) {
  if (/^(REQUEST|ANSWER)\s*:/i.test(line) && !/^(PROFILE|SAVE|DRAFT|DIGEST)\s*:/.test(line)) {
    return { reason: "relay text, not a portal command" };
  }
  const m = /^(PROFILE|SAVE|DRAFT|DIGEST)\s*:\s*([\s\S]*)$/.exec(line);
  if (!m) return { reason: "not a portal command" };
  const [, cmd, payload] = m;
  if (cmd === "SAVE") return parseIdCommand("save", payload, known);
  if (cmd === "DRAFT") return parseIdCommand("draft", payload, known);
  return parseFields(cmd, payload);
}

// text is the whole doc. options.data, when passed, is a data.json object
// ({ rows }) and SAVE/DRAFT ids must occur in it. Without it, ids are
// checked against the format only.
export function parseCommands(text, options = {}) {
  if (typeof text !== "string") {
    return { commands: [], ignored: [{ line: 0, text: "", reason: "input is not text" }] };
  }
  if (text.length > MAX_INPUT_CHARS) {
    return { commands: [], ignored: [{ line: 0, text: "", reason: `input exceeds ${MAX_INPUT_CHARS} characters` }] };
  }
  const known = idSet(options.data);
  const commands = [];
  const ignored = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\u2028|\u2029/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(raw)) {
      ignored.push({ line: lineNo, text: echo(raw), reason: "control characters" });
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    if (line.length > MAX_LINE_CHARS) {
      ignored.push({ line: lineNo, text: echo(line), reason: `line exceeds ${MAX_LINE_CHARS} characters` });
      continue;
    }
    const parsed = parseLine(line, known);
    if (parsed.command) commands.push(parsed.command);
    else ignored.push({ line: lineNo, text: echo(line), reason: parsed.reason });
  }
  return { commands, ignored };
}
