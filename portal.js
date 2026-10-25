// The welcome quiz and the "For you" portal. The quiz asks five questions, saves a
// profile in this browser, and everything on the portal is filtered by it: the
// Florida county heatmap, best-matching contracts, grants, expiring work and the
// free local help that fits.
import { TRADES, CERTS, profileStems, stemMatcher, setAsideAllowed, profileToText, filterGrants } from "./lib.js?v=3";
import { FL_COUNTIES, countyOf, SOUTH_FLORIDA } from "./florida.js?v=1";
import { floridaMap } from "./charts.js?v=9";
import { floridaOpportunityCounts } from "./county-counts.js?v=1";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Free, real organizations that help Miami businesses win public work. Verified
// Oct 2026 against the organizations' own pages.
const HELP = [
  { id: "apex", title: "Florida APEX Accelerator at FIU", what: "Free one-on-one help with government contracts for Miami-Dade and Monroe businesses: SAM.gov registration, finding bids, writing proposals.", link: "https://business.fiu.edu/news/2024/florida-apex-accelerator-at-fiu-business-creates-pathways-to-government-contracts-and-innovation-programs.html", always: true },
  { id: "sbe", title: "Get Miami-Dade SBE certified", what: "County certification for small businesses (construction, A&E, goods and services). It unlocks set-aside work such as the county's janitorial and landscaping SBE pools. Questions: 305-375-3111.", link: "https://www.miamidade.gov/global/strategic-procurement/small-business-enterprise-certification.page", unless: "sbe" },
  { id: "supplier", title: "Register as a Miami-Dade supplier", what: "Every county bid goes through the INFORMS supplier portal. Register before you need it. Vendor help: 305-375-5773.", link: "https://supplier.miamidade.gov/" },
  { id: "sbdc", title: "Florida SBDC at FIU", what: "Free business consulting across Miami-Dade and the Keys, including help getting ready for government work.", link: "https://growbiz.fiu.edu/" },
  { id: "sam", title: "Register on SAM.gov", what: "Free registration required for every federal contract and grant. Never pay a third party to do it.", link: "https://sam.gov/" },
  { id: "future", title: "Miami-Dade future solicitations", what: "Drafts of work the county plans to buy, with the buyer's name. The best time to talk to them is now.", link: "https://www.miamidade.gov/apps/isd/StratProc/Home/FutureSolicitations" },
];

export const COUNTY_NAMES = Object.keys(FL_COUNTIES).sort((a, b) => a === "Miami-Dade" ? -1 : b === "Miami-Dade" ? 1 : a.localeCompare(b));

export function initPortal(ctx) {
  const { F } = ctx;
  let profile = ctx.store.get("profile") ? (() => { try { return JSON.parse(ctx.store.get("profile")); } catch { return null; } })() : null;
  let countyFilter = "";

  // ---- quiz ----
  const quiz = $("#quiz");
  const steps = [...quiz.querySelectorAll(".q-step")];
  let at = 0, draft = {};
  const tradeBox = $("#q-trades"), certBox = $("#q-certs"), countySel = $("#q-county");
  tradeBox.innerHTML = TRADES.map((t) => `<label class="pick"><input type="checkbox" value="${t.id}"><span>${esc(t.label)}</span></label>`).join("");
  certBox.innerHTML = CERTS.map((c) => `<label class="pick"><input type="checkbox" value="${c.id}"><span>${esc(c.label)}</span></label>`).join("");
  countySel.innerHTML = COUNTY_NAMES.map((c) => `<option value="${esc(c)}">${esc(c)} County</option>`).join("") + '<option value="outside">Outside Florida</option>';

  function showStep(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, k) => { s.hidden = k !== at; });
    $("#q-back").hidden = at === 0;
    $("#q-next").textContent = at === steps.length - 1 ? "Open my portal" : "Next";
    $("#q-progress").innerHTML = steps.map((_, k) => `<i class="${k <= at ? "on" : ""}"></i>`).join("");
    steps[at].querySelector("input,select,button")?.focus();
  }
  function fillQuiz(p) {
    draft = { kind: "business", trades: [], certs: [], county: "Miami-Dade", size: "", maxJob: "", other: "", ...(p || {}) };
    quiz.querySelectorAll('input[name="q-kind"]').forEach((r) => { r.checked = r.value === draft.kind; });
    tradeBox.querySelectorAll("input").forEach((c) => { c.checked = draft.trades.includes(c.value); });
    certBox.querySelectorAll("input").forEach((c) => { c.checked = draft.certs.includes(c.value); });
    $("#q-other").value = draft.other || "";
    countySel.value = draft.county || "Miami-Dade";
    $("#q-size").value = draft.size || ""; $("#q-maxjob").value = draft.maxJob || "";
  }
  function readQuiz() {
    return {
      kind: quiz.querySelector('input[name="q-kind"]:checked')?.value || "business",
      trades: [...tradeBox.querySelectorAll("input:checked")].map((c) => c.value),
      other: $("#q-other").value.trim().slice(0, 80),
      county: countySel.value,
      size: $("#q-size").value, maxJob: $("#q-maxjob").value,
      certs: [...certBox.querySelectorAll("input:checked")].map((c) => c.value),
    };
  }
  function openQuiz() { fillQuiz(profile); showStep(0); quiz.showModal(); }
  $("#q-next").onclick = () => {
    if (at === 1 && !readQuiz().trades.length && !readQuiz().other) { $("#q-hint").textContent = "Pick at least one, or type what you do."; return; }
    $("#q-hint").textContent = "";
    if (at < steps.length - 1) return showStep(at + 1);
    profile = readQuiz();
    ctx.store.set("profile", JSON.stringify(profile));
    quiz.close();
    ctx.onProfile(profile);
    document.querySelector("[data-tab=foryou]").click();
  };
  $("#q-back").onclick = () => showStep(at - 1);
  $("#q-skip").onclick = () => { quiz.close(); };
  document.querySelectorAll(".edit-profile").forEach((b) => b.onclick = openQuiz);

  // ---- the portal ----
  const tradeLabel = (p) => [...(p.trades || []).map((id) => TRADES.find((t) => t.id === id)?.label), p.other].filter(Boolean).join(", ");
  function matches(p) {
    const fits = stemMatcher(profileStems(p));
    const today = ctx.localISODate();
    const out = [];
    for (let i = 0; i < ctx.rows.length; i++) {
      const r = ctx.rows[i];
      if (r[F.DUE] < today || !r[F.US]) continue;
      if (!fits(ctx.hay[i])) continue;
      if (!setAsideAllowed(ctx.setaside(r), p)) continue;
      out.push(r);
    }
    return out;
  }
  const rank = (p) => (r) => {
    const c = r[F.STATE] === "FL" ? countyOf(r[F.CITY], ctx.source(r)) : "";
    const local = c && c === p.county ? 3 : SOUTH_FLORIDA.includes(c) && SOUTH_FLORIDA.includes(p.county) ? 2 : r[F.STATE] === "FL" ? 1 : 0;
    return local * 100 + (r[F.SCORE] || 0);
  };

  function render() {
    const host = $("#portal");
    if (!profile) { $("#portal-empty").hidden = false; host.hidden = true; return; }
    $("#portal-empty").hidden = true; host.hidden = false;
    const p = profile;
    const all = matches(p);
    const fl = all.filter((r) => r[F.STATE] === "FL");
    const inCounty = fl.filter((r) => countyOf(r[F.CITY], ctx.source(r)) === p.county);
    const soon = all.filter((r) => ctx.daysLeft(r[F.DUE]) <= 7).length;
    const grantWho = p.kind === "nonprofit" ? "nonprofit" : p.kind === "exploring" ? "" : "small_business";
    const grants = filterGrants(ctx.grants(), { who: grantWho, q: "", today: ctx.localISODate() });
    const grantFits = stemMatcher(profileStems(p));
    const myGrants = profileStems(p).length ? grants.filter((g) => grantFits(`${g.title} ${g.desc}`.toLowerCase())) : [];

    $("#portal-who").textContent = `${p.kind === "nonprofit" ? "A nonprofit" : "A business"} in ${p.county === "outside" ? "the US" : p.county + " County"}${tradeLabel(p) ? ` · ${tradeLabel(p)}` : ""}`;
    $("#portal-tiles").innerHTML = [
      [p.county === "outside" ? "Nationwide" : `In ${p.county}`, inCounty.length, p.county === "outside" ? "" : "open contracts in your county"],
      ["In Florida", fl.length, "open contracts in your trade"],
      ["Nationwide", all.length, `${soon} closing this week`],
      ["Grants for you", (myGrants.length || grants.length), myGrants.length ? "match your trade" : `open to ${grantWho === "nonprofit" ? "nonprofits" : "small businesses"}`],
    ].map(([l, v, s]) => `<div class="card tile"><div class="label">${esc(l)}</div><div class="value">${Number(v).toLocaleString()}</div><div class="sub">${esc(s)}</div></div>`).join("");

    // Every open Florida contract is the light layer. Trade matches are darker.
    const matchedSet = new Set(all);
    const counts = floridaOpportunityCounts(ctx.rows, {
      today: ctx.localISODate(),
      dueOf: (r) => r[F.DUE],
      isFlorida: (r) => r[F.STATE] === "FL",
      countyOf: (r) => countyOf(r[F.CITY], ctx.source(r)),
      isMatch: (r) => matchedSet.has(r),
    });
    const unmapped = counts.unmapped;
    $("#portal-map-sub").textContent = `Light orange counts every open contract. Darker orange counts your trade. The outlined number is the open count. ${p.county !== "outside" ? `${p.county} is outlined. ` : ""}Click a county to see its contracts.${unmapped ? ` ${unmapped} open Florida notice${unmapped === 1 ? " names" : "s name"} no city, so ${unmapped === 1 ? "it is" : "they are"} not on the map.` : ""}`;
    requestAnimationFrame(() => floridaMap($("#portal-map"), counts.matched, {
      base: counts.open,
      selected: countyFilter || (p.county !== "outside" ? p.county : ""),
      ariaLabel: "Opportunities in Florida by county",
      onClick: (c) => { countyFilter = countyFilter === c ? "" : c; render(); $("#portal-list").scrollIntoView({ behavior: "smooth", block: "start" }); },
    }));

    // Best matches: their county first, then South Florida, Florida, nationwide.
    const pool = countyFilter ? fl.filter((r) => countyOf(r[F.CITY], ctx.source(r)) === countyFilter) : all;
    const seen = new Set();
    const best = [...pool].sort((a, b) => rank(p)(b) - rank(p)(a) || a[F.DUE].localeCompare(b[F.DUE]))
      .filter((r) => !seen.has(r[F.TITLE]) && seen.add(r[F.TITLE])).slice(0, 8);
    $("#portal-list-title").textContent = countyFilter ? `Open in ${countyFilter} County` : "Best matches for you";
    $("#portal-clear").hidden = !countyFilter;
    const list = $("#portal-list");
    list.innerHTML = best.length ? best.map(ctx.oppCard).join("") : `<div class="empty">Nothing open in your trade ${countyFilter ? "in " + esc(countyFilter) : "right now"}. Try the agent, or widen your trades in your profile.</div>`;
    list.querySelectorAll(".opp").forEach((c) => c.onclick = () => ctx.openDetail(c.dataset.id));
    list.querySelectorAll(".find-co").forEach((b) => b.onclick = (e) => { e.stopPropagation(); ctx.openVendors(b.dataset.id); });

    const gl = (myGrants.length ? myGrants : grants).slice(0, 4);
    $("#portal-grants").innerHTML = gl.length ? gl.map(ctx.grantCard).join("") : '<div class="empty small">No open grants match right now.</div>';

    const certs = new Set(p.certs || []);
    $("#portal-help").innerHTML = HELP.filter((h) => !h.unless || !certs.has(h.unless))
      .filter((h) => p.county === "outside" ? ["sam", "apex"].includes(h.id) : true).slice(0, 4)
      .map((h) => `<a class="card help-card" href="${esc(h.link)}" target="_blank" rel="noopener"><strong>${esc(h.title)}</strong><span>${esc(h.what)}</span><em>Open ↗</em></a>`).join("");
  }
  $("#portal-clear").onclick = () => { countyFilter = ""; render(); };
  $("#portal-agent").onclick = () => { $("#agent-input").value = profileToText(profile); document.querySelector("[data-tab=agent]").click(); };

  return {
    render,
    profile: () => profile,
    openQuiz,
    // First visit: greet with the quiz, unless a deep link asked for something else.
    maybeGreet: () => { if (!profile && !location.hash) openQuiz(); },
    help: HELP,
  };
}
