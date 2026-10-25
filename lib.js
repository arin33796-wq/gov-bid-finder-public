// Pure logic shared by the page and the tests. Nothing here touches the DOM.

const DAY_MS = 86400e3;

// WHY: toISOString() is UTC, so in a US evening it already reads tomorrow and a
// contract due today drops out early. Dates in the feed are local calendar days.
export const localISODate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const addDaysISO = (days, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

// Whole calendar days from `today` to `due`, both YYYY-MM-DD. Due today is 0.
// WHY: both strings parse as UTC midnight, so the difference is an exact number of
// days with no daylight-saving or time-of-day drift.
export const daysBetween = (today, due) => Math.round((Date.parse(due) - Date.parse(today)) / DAY_MS);

// SAM.gov records "No Set aside used" as a set-aside value. It means the opposite:
// open to everyone. Treating it as truthy inflated the small-business count.
export const isSetAside = (label) => !!label && !/^no set[\s-]?aside/i.test(label);

export const countOpen = (rows, dueIdx, today) => {
  let n = 0;
  for (const r of rows) if (r[dueIdx] >= today) n++;
  return n;
};

// A renewal whose end date has passed is no longer a contract you can prepare for.
export const liveRenewals = (rows, endIdx, today) => rows.filter((r) => r[endIdx] >= today);

// The feed sometimes carries 13 months; the page promises the last 12.
export const recentMonths = (months, n = 12) => months.slice(-n);

// WHY 5x: the snapshot's latest month held 7,374 awards against a median of ~190
// for the others, a ~39x jump caused by how records were collected, not by spending.
// Genuine month-to-month swings in award counts stay well under 5x the median.
const COVERAGE_SKEW_RATIO = 5;
export const coverageSkewed = (months) => {
  if (months.length < 3) return false;
  const counts = months.slice(0, -1).map((m) => m.value).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  return median > 0 && months[months.length - 1].value > COVERAGE_SKEW_RATIO * median;
};

// ---- the visitor's profile, from the welcome quiz ----
// Trades offered in the quiz: label and the search stems that find them.
// WHY stems: search is substring match, so "roof" also catches "roofing" and "roofs".
export const TRADES = [
  { id: "construction", label: "Construction", stems: ["construction", "renovation"] },
  { id: "painting", label: "Painting", stems: ["paint"] },
  { id: "janitorial", label: "Janitorial & cleaning", stems: ["janitor", "custodial", "cleaning"] },
  { id: "landscaping", label: "Landscaping & grounds", stems: ["landscap", "grounds maint", "mowing"] },
  { id: "roofing", label: "Roofing", stems: ["roof"] },
  { id: "hvac", label: "HVAC", stems: ["hvac", "air condition", "chiller"] },
  { id: "plumbing", label: "Plumbing", stems: ["plumb"] },
  { id: "electrical", label: "Electrical", stems: ["electric"] },
  { id: "security", label: "Security guards", stems: ["guard", "security services"] },
  { id: "food", label: "Food & catering", stems: ["food service", "catering", "meals"] },
  { id: "it", label: "IT & tech support", stems: ["information technology", "it support", "software"] },
  { id: "transport", label: "Trucking & transport", stems: ["transportation", "hauling", "trucking"] },
  { id: "consulting", label: "Consulting & training", stems: ["consult", "training"] },
  { id: "medical", label: "Medical & health", stems: ["medical", "health"] },
];
export const CERTS = [
  { id: "sbe", label: "Miami-Dade SBE" },
  { id: "osd", label: "Florida minority or women-owned (OSD)" },
  { id: "8a", label: "SBA 8(a)" },
  { id: "hubzone", label: "HUBZone" },
  { id: "sdvosb", label: "Service-disabled veteran-owned" },
  { id: "wosb", label: "Women-owned (WOSB)" },
];

// One regex for a set of stems, anchored at the start of a word, so "construction"
// does not match "reconstruction" and "paint" still matches "painting".
export const stemMatcher = (stems) => {
  const parts = stems.map((s) => String(s).toLowerCase().trim()).filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return () => true;
  const re = new RegExp(`(?:^|[^a-z0-9])(?:${parts.join("|")})`);
  return (text) => re.test(String(text || "").toLowerCase());
};

// An industry name supports a trade when a stem is the main line of work: the
// text before the first comma, or the classifying tail after the last comma
// ("Highway, Street, and Bridge Construction"). A stem that only sits in a
// middle clause does not ("Automotive Body, Paint, and Interior Repair" is
// auto-body work, and it was the only Florida hit for a painter).
export function naicsSupportsTrade(name, stems) {
  const n = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!n || !stems?.length) return false;
  const fits = stemMatcher(stems);
  if (!fits(n)) return false;
  const parts = n.split(",").map((s) => s.trim()).filter(Boolean);
  if (fits(parts[0])) return true;
  return parts.length > 1 && fits(parts[parts.length - 1]);
}

// Title and description first. The industry name counts only when it actually
// supports the trade, so a side activity in the code does not create a hit.
export function noticeMatchesTrade(text, naicsName, stems) {
  if (!stems?.length) return true;
  if (stemMatcher(stems)(text)) return true;
  return naicsSupportsTrade(naicsName, stems);
}

export const profileStems = (p) => {
  const stems = (p?.trades || []).flatMap((id) => TRADES.find((t) => t.id === id)?.stems || []);
  const other = String(p?.other || "").toLowerCase().split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 2);
  return [...new Set([...stems, ...other])];
};

// Which federal set-asides a profile may bid on. "Open to all" and plain small
// business set-asides are always fine for a small business.
export function setAsideAllowed(label, p) {
  if (!label) return true;
  const l = label.toLowerCase(), c = new Set(p?.certs || []);
  if (/8\(a\)/.test(l)) return c.has("8a");
  if (/hubzone/.test(l)) return c.has("hubzone");
  if (/service-disabled|sdvosb|veteran/.test(l)) return c.has("sdvosb");
  if (/women|wosb|edwosb/.test(l)) return c.has("wosb");
  if (/indian|native/.test(l)) return false;
  return p?.kind !== "nonprofit";
}

// The profile in one paragraph, for the agent's text box.
export function profileToText(p) {
  if (!p) return "";
  const who = p.kind === "nonprofit" ? "a nonprofit / community organization" : p.kind === "exploring" ? "someone exploring government work" : "a small business";
  const trades = (p.trades || []).map((id) => TRADES.find((t) => t.id === id)?.label).filter(Boolean);
  if (p.other) trades.push(p.other);
  const where = p.county === "outside" ? "outside Florida" : p.county ? `${p.county} County, Florida` : "Florida";
  const certs = (p.certs || []).map((id) => CERTS.find((c) => c.id === id)?.label).filter(Boolean);
  return [
    `We are ${who} in ${where}${trades.length ? `, working in ${trades.join(", ").toLowerCase()}` : ""}.`,
    p.size ? `Team size: ${p.size} people.` : "",
    p.maxJob ? `We can take on jobs up to about $${Number(p.maxJob).toLocaleString("en-US")}.` : "",
    certs.length ? `Certifications: ${certs.join(", ")}.` : "No special certifications.",
    "Find us contracts and grants we can realistically win.",
  ].filter(Boolean).join(" ");
}

// ---- grants ----
// WHY: most open federal grants aimed at small businesses are research awards
// (activity codes like R01, U54, T32, SBIR). Useful to labs, noise to a contractor.
// The code is one letter plus two digits. An earlier pattern listed only some
// digit bands (U0x, U2x, U4x, T3x), so U54, U19, T03 and T42 stayed visible,
// including a construction-safety research center. FY27 is a fiscal year (two
// letters) and must not match.
const RESEARCH_RE = /\b(?:[RUKTPF]\d{2}|UG3|UH3|SBIR|STTR)\b|clinical trial/i;
export const isResearchGrant = (g) => RESEARCH_RE.test(g?.title || "") || /national institutes of health/i.test(g?.agency || "");

// A grant fits a trade when a stem is in the title or a category. The synopsis
// is ignored: a chemical program that only defines "construction and demolition
// waste" is not a construction grant.
export function grantMatchesTrade(grant, stems) {
  if (!stems?.length) return false;
  const head = `${grant?.title || ""} ${(grant?.categories || []).join(" ")}`;
  return stemMatcher(stems)(head);
}

// WHY 3: an empty state can name a few real alternatives. More than that is a second list.
const EMPTY_TRADE_CAP = 3;

// Suggestions for a filter that matched nothing. Counts come from the caller;
// a suggestion is kept only when its count is a real number above zero, so the
// page never invents a total. `kind: "trade"` is capped; widen steps are not.
export function emptyMatchAdvice({ subject, place = "", suggestions = [] } = {}) {
  const what = String(subject || "results").trim() || "results";
  const where = String(place || "").trim();
  const widen = [];
  const trades = [];
  for (const s of suggestions) {
    const count = Number(s?.count);
    if (!Number.isFinite(count) || count <= 0 || !s?.label) continue;
    const item = { id: String(s.id || s.label), label: String(s.label), count };
    if (s.kind === "trade") { if (trades.length < EMPTY_TRADE_CAP) trades.push(item); }
    else widen.push(item);
  }
  return { title: where ? `No open ${what} in ${where}.` : `No open ${what}.`, widen, trades };
}

export function filterGrants(grants, { who = "", category = "", q = "", hideResearch = true, today = "" } = {}) {
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return grants.filter((g) => {
    if (today && g.closes && g.closes < today) return false;
    if (who && !g.eligible.includes(who)) return false;
    if (category && !g.categories.includes(category)) return false;
    if (hideResearch && isResearchGrant(g)) return false;
    if (terms.length) { const h = `${g.title} ${g.desc} ${g.agency} ${g.categories.join(" ")}`.toLowerCase(); if (!terms.every((t) => h.includes(t))) return false; }
    return true;
  });
}

// The drafted outreach email as plain text, ready to paste into any mail client.
export const emailText = ({ to, su, bo }) => [to ? `To: ${to}` : "", `Subject: ${su}`, "", bo].filter((l, i) => i > 0 || l).join("\n");
