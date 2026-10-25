import { floridaMap, fmt, usd } from "./charts.js?v=7";
import { countyOf } from "./florida.js?v=1";
import { localISODate, addDaysISO, countOpen, liveRenewals, filterGrants } from "./lib.js?v=4";

// ---- slide navigation ----
const slides = [...document.querySelectorAll(".slide")];
let at = Math.max(0, Math.min(slides.length - 1, Number(location.hash.slice(1)) - 1 || 0));
function show(i) {
  at = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, k) => s.classList.toggle("active", k === at));
  document.getElementById("progress").style.width = `${((at + 1) / slides.length) * 100}%`;
  document.getElementById("count").textContent = `${at + 1} / ${slides.length}`;
  history.replaceState(null, "", `#${at + 1}`);
  if (slides[at].querySelector("#deck-map")) drawMap();
}
addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); show(at + 1); }
  if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); show(at - 1); }
  if (e.key === "Home") show(0);
  if (e.key === "End") show(slides.length - 1);
});
// WHY: a click anywhere advances, like a clicker, except on links and controls.
document.addEventListener("click", (e) => { if (!e.target.closest("a,button,.deck-nav,svg")) show(at + 1); });
document.getElementById("prev").onclick = () => show(at - 1);
document.getElementById("next").onclick = () => show(at + 1);
show(at);

// ---- live numbers, filled in once the snapshot loads ----
// Row columns mirror F in app.js.
const DUE = 5, STATE = 7, VALUE = 19;
const STATE_NAME = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "Washington, D.C.", PR: "Puerto Rico" };
const setStat = (k, v) => document.querySelectorAll(`[data-stat="${k}"]`).forEach((n) => { n.textContent = v; });

let byCounty = null;
function drawMap() {
  const host = document.getElementById("deck-map");
  if (!byCounty) { host.innerHTML = '<div class="empty small">Loading…</div>'; return; }
  floridaMap(host, byCounty, { selected: "Miami-Dade", ariaLabel: "Open contracts by Florida county" });
}

const today = localISODate();
const [data, renewals, vendors, grantsFile] = await Promise.all([
  fetch("./data.json").then((r) => r.json()),
  fetch("./renewals.json").then((r) => r.json()).catch(() => []),
  fetch("./vendors.json").then((r) => r.json()).catch(() => ({})),
  fetch("./grants.json").then((r) => r.json()).catch(() => ({ grants: [] })),
]);
const SRC = data.meta.dicts.sources, CITY = 8;
const open = data.rows.filter((r) => r[DUE] >= today);
setStat("open", countOpen(data.rows, DUE, today).toLocaleString());
const values = open.map((r) => r[VALUE]).filter(Boolean).sort((a, b) => a - b);
setStat("median", values.length ? usd(values[Math.floor(values.length / 2)]) : "n/a");
setStat("fl", open.filter((r) => r[STATE] === "FL").length.toLocaleString());

// R.END = 1, R.AMT = 2, R.STATE = 5 in renewals.json (see R in app.js).
const yearOut = addDaysISO(365);
const flRenew = liveRenewals(renewals, 1, today).filter((r) => r[5] === "FL" && r[1] <= yearOut);
setStat("flRenewValue", usd(flRenew.reduce((a, r) => a + r[2], 0)));
setStat("flRenewCount", flRenew.length.toLocaleString());

const companies = new Set();
for (const list of Object.values(vendors)) for (const v of list) companies.add(v[0]);
setStat("companies", fmt(companies.size));
setStat("awards", fmt(data.meta.awards_by_month.reduce((a, m) => a + m.value, 0)));

byCounty = {};
for (const r of open) if (r[STATE] === "FL") { const c = countyOf(r[CITY], SRC[r[10]]); if (c) byCounty[c] = (byCounty[c] || 0) + 1; }
setStat("miami", (byCounty["Miami-Dade"] || 0).toLocaleString());
setStat("mdcBids", open.filter((r) => SRC[r[10]] === "miami-dade").length.toLocaleString());
// WHY: the slide says these are open to small businesses and nonprofits.
// filterGrants includes Unrestricted for both (any applicant may apply) and
// leaves out Others, whose eligibility is only in the listing text.
const grantIds = new Set();
for (const who of ["small_business", "nonprofit"]) {
  for (const g of filterGrants(grantsFile.grants, { who, hideResearch: false, today })) grantIds.add(g.id);
}
setStat("grants", grantIds.size.toLocaleString());
if (slides[at].querySelector("#deck-map")) drawMap();
