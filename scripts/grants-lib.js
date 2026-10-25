// Grants.gov public API (no key): search open and forecast grants by who may
// apply, then fetch each one's details. These helpers shape the records.
import { cleanText } from "./sam-lib.js";

export const SEARCH_URL = "https://api.grants.gov/v1/api/search2";
export const DETAIL_URL = "https://api.grants.gov/v1/api/fetchOpportunity";

// Grants.gov applicant-type codes for the people this site serves. Governments and
// universities are left out on purpose: they have grant offices already.
// 99 is "open to any applicant type", so a small business, nonprofit, or
// individual may apply; filters treat that group as open to all three.
// 25 is not those audiences. Grants.gov uses it when eligibility is only in
// the listing text, so it stays its own group and is not implied for them.
export const ELIGIBILITY = {
  "23": "small_business",
  "12": "nonprofit",      // 501(c)(3)
  "13": "nonprofit",      // nonprofit without 501(c)(3)
  "21": "individual",
  "25": "other",          // Others: who may apply is only in the listing text
  "99": "unrestricted",   // any applicant type, including the three above
};

// "11/17/2026" -> "2026-11-17"; "" stays "" (forecasts often have no close date yet).
export const mdy = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};
const money = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

// WHY 320: enough to tell what the grant funds; full text is one click away.
const DESC_CHARS = 320;

export function toGrant(hit, eligible, detail) {
  const s = detail?.synopsis || {};
  return {
    id: String(hit.id),
    number: hit.number || "",
    title: cleanText(hit.title),
    agency: hit.agency || hit.agencyCode || "",
    status: hit.oppStatus === "forecasted" ? "forecast" : "open",
    opens: mdy(hit.openDate),
    closes: mdy(hit.closeDate),
    ceiling: money(s.awardCeiling),
    floor: money(s.awardFloor),
    eligible: [...new Set(eligible)].sort(),
    categories: (s.fundingActivityCategories || []).map((c) => c.description).filter(Boolean),
    desc: cleanText(s.synopsisDesc).slice(0, DESC_CHARS),
    contact: String(s.agencyContactEmail || "").trim(),
    link: `https://www.grants.gov/search-results-detail/${hit.id}`,
  };
}

// Open now, or forecast with no close date yet.
export const stillOpen = (g, today) => !g.closes || g.closes >= today;
