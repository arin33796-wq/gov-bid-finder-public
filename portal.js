// The welcome quiz and the "For you" portal. The quiz asks five questions, saves a
// profile in this browser, and everything on the portal is filtered by it: the
// Florida county heatmap, best-matching contracts, grants, expiring work and the
// free local help that fits.
import { TRADES, CERTS, profileStems, setAsideAllowed, profileToText, filterGrants, noticeMatchesTrade, grantMatchesTrade, emptyMatchAdvice } from "./lib.js?v=5";
import { FL_COUNTIES, countyOf, SOUTH_FLORIDA } from "./florida.js?v=1";
import { floridaMap } from "./charts.js?v=8";

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
  function noticeText(r) {
    return `${r[F.TITLE]} ${r[F.SNIP]} ${r[F.NAICS]}`.toLowerCase();
  }
  function matches(p) {
    const stems = profileStems(p);
    const today = ctx.localISODate();
    const out = [];
    for (let i = 0; i < ctx.rows.length; i++) {
      const r = ctx.rows[i];
      if (r[F.DUE] < today || !r[F.US]) continue;
      if (!noticeMatchesTrade(noticeText(r), ctx.naicsName(r[F.NAICS]), stems)) continue;
      if (!setAsideAllowed(ctx.setaside(r), p)) continue;
      out.push(r);
    }
    return out;
  }
  // Other trades that actually have open notices, busiest first. Used only when
  // this profile's own trade came back empty, so the scan is not on the happy path.
  function tradeSuggestions(state) {
    const today = ctx.localISODate();
    const mine = new Set(profileStems(profile));
    const out = [];
    for (const t of TRADES) {
      if (t.stems.some((s) => mine.has(s))) continue;
      let n = 0;
      for (const r of ctx.rows) {
        if (r[F.DUE] < today || !r[F.US]) continue;
        if (state && r[F.STATE] !== state) continue;
        if (!noticeMatchesTrade(noticeText(r), ctx.naicsName(r[F.NAICS]), t.stems)) continue;
        if (!setAsideAllowed(ctx.setaside(r), profile)) continue;
        n++;
      }
      out.push({ id: t.id, label: t.label, count: n, kind: "trade" });
    }
    return out.sort((a, b) => b.count - a.count);
  }
  function wireEmpty(host) {
    host.querySelectorAll("[data-empty]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.empty;
      if (id === "portal-florida" || id === "portal-nationwide") {
        countyFilter = "";
        render();
        if (id === "portal-nationwide") $("#portal-list").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (id === "portal-grants") $("#portal-more-grants").click();
    });
    host.querySelectorAll("[data-empty-trade]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const t = TRADES.find((x) => x.id === b.dataset.emptyTrade);
      if (t && ctx.jump) ctx.jump({ q: t.stems[0], state: countyFilter || (profile?.county && profile.county !== "outside" ? "FL" : "") });
    });
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
    const stems = profileStems(p);
    const myGrants = stems.length ? grants.filter((g) => grantMatchesTrade(g, stems)) : [];
    const grantAudience = grantWho === "nonprofit" ? "nonprofits" : grantWho ? "small businesses" : "anyone";

    $("#portal-who").textContent = `${p.kind === "nonprofit" ? "A nonprofit" : "A business"} in ${p.county === "outside" ? "the US" : p.county + " County"}${tradeLabel(p) ? ` · ${tradeLabel(p)}` : ""}`;
    $("#portal-tiles").innerHTML = [
      [p.county === "outside" ? "Nationwide" : `In ${p.county}`, inCounty.length, p.county === "outside" ? "" : "open contracts in your county"],
      ["In Florida", fl.length, "open contracts in your trade"],
      ["Nationwide", all.length, `${soon} closing this week`],
      ["Grants for you", myGrants.length, myGrants.length ? "match your trade" : grants.length ? `none name your trade · ${grants.length.toLocaleString("en-US")} open to ${grantAudience}` : "none open right now"],
    ].map(([l, v, s]) => `<div class="card tile"><div class="label">${esc(l)}</div><div class="value">${Number(v).toLocaleString()}</div><div class="sub">${esc(s)}</div></div>`).join("");

    // Florida county heatmap of contracts in their trade.
    const byCounty = {};
    for (const r of fl) { const c = countyOf(r[F.CITY], ctx.source(r)); if (c) byCounty[c] = (byCounty[c] || 0) + 1; }
    const unmapped = fl.filter((r) => !countyOf(r[F.CITY], ctx.source(r))).length;
    const mapHost = $("#portal-map");
    if (!fl.length) {
      $("#portal-map-sub").textContent = all.length
        ? "None of these name a Florida county. The nationwide matches are listed below."
        : "No open contracts in your trade right now.";
      mapHost.innerHTML = ctx.emptyHtml(emptyMatchAdvice({
        subject: `${tradeLabel(p) || "matching"} contracts`,
        place: "Florida",
        suggestions: [
          { id: "portal-nationwide", label: "Nationwide", count: all.length, kind: "widen" },
          ...tradeSuggestions("FL"),
        ],
      }));
      wireEmpty(mapHost);
    } else {
      $("#portal-map-sub").textContent = `Contracts in your trade, by county. ${p.county !== "outside" ? `${p.county} is outlined. ` : ""}Click a county to see its contracts.${unmapped ? ` ${unmapped} Florida notice${unmapped === 1 ? " names" : "s name"} no city, so ${unmapped === 1 ? "it is" : "they are"} not on the map.` : ""}`;
      requestAnimationFrame(() => floridaMap(mapHost, byCounty, {
        selected: countyFilter || (p.county !== "outside" ? p.county : ""),
        valueLabel: "open contracts in your trade", ariaLabel: "Open contracts in your trade by Florida county",
        onClick: (c) => { countyFilter = countyFilter === c ? "" : c; render(); $("#portal-list").scrollIntoView({ behavior: "smooth", block: "start" }); },
      }));
    }

    // Best matches: their county first, then South Florida, Florida, nationwide.
    const pool = countyFilter ? fl.filter((r) => countyOf(r[F.CITY], ctx.source(r)) === countyFilter) : all;
    const seen = new Set();
    const best = [...pool].sort((a, b) => rank(p)(b) - rank(p)(a) || a[F.DUE].localeCompare(b[F.DUE]))
      .filter((r) => !seen.has(r[F.TITLE]) && seen.add(r[F.TITLE])).slice(0, 8);
    $("#portal-list-title").textContent = countyFilter ? `Open in ${countyFilter} County` : "Best matches for you";
    $("#portal-clear").hidden = !countyFilter;
    const list = $("#portal-list");
    const place = countyFilter ? `${countyFilter} County` : (!fl.length && p.county !== "outside" ? "Florida" : (!inCounty.length && p.county !== "outside" ? `${p.county} County` : ""));
    const showGap = !best.length || (!countyFilter && p.county !== "outside" && !inCounty.length) || (!fl.length && p.county !== "outside");
    const gap = showGap ? ctx.emptyHtml(emptyMatchAdvice({
      subject: `${tradeLabel(p) || "matching"} contracts`,
      place: best.length && !countyFilter && inCounty.length ? "" : place,
      suggestions: [
        countyFilter || (p.county !== "outside" && !inCounty.length && fl.length) ? { id: "portal-florida", label: "All of Florida", count: fl.length, kind: "widen" } : null,
        { id: "portal-nationwide", label: "Nationwide", count: all.length, kind: "widen" },
        ...(!best.length || !fl.length ? tradeSuggestions(countyFilter || p.county !== "outside" ? "FL" : "") : []),
      ].filter(Boolean),
    })) : "";
    // A county with nothing still lists the wider matches underneath the note,
    // so the zeros in the tiles are explained instead of looking like a broken page.
    list.innerHTML = (best.length ? gap : "") + (best.length ? best.map(ctx.oppCard).join("") : gap);
    wireEmpty(list);
    list.querySelectorAll(".opp").forEach((c) => c.onclick = () => ctx.openDetail(c.dataset.id));
    list.querySelectorAll(".find-co").forEach((b) => b.onclick = (e) => { e.stopPropagation(); ctx.openVendors(b.dataset.id); });

    const grantHost = $("#portal-grants");
    if (myGrants.length) grantHost.innerHTML = myGrants.slice(0, 4).map(ctx.grantCard).join("");
    else {
      grantHost.innerHTML = ctx.emptyHtml(emptyMatchAdvice({
        subject: "grants naming your trade",
        suggestions: [{ id: "portal-grants", label: `Grants open to ${grantAudience}`, count: grants.length, kind: "widen" }],
      }));
      wireEmpty(grantHost);
    }

    const certs = new Set(p.certs || []);
    $("#portal-help").innerHTML = HELP.filter((h) => !h.unless || !certs.has(h.unless))
      .filter((h) => p.county === "outside" ? ["sam", "apex"].includes(h.id) : true).slice(0, 4)
      .map((h) => `<a class="card help-card" href="${esc(h.link)}" target="_blank" rel="noopener"><strong>${esc(h.title)}</strong><span>${esc(h.what)}</span><em>Open ↗</em></a>`).join("");
  }
  $("#portal-clear").onclick = () => { countyFilter = ""; render(); };
  // Outside a Claude artifact the agent cannot run. Filling the box and opening
  // the tab still works; the note on that tab explains where the agent runs.
  $("#portal-agent").onclick = () => {
    const text = profileToText(profile);
    const box = $("#agent-input");
    if (box && text) box.value = text;
    document.querySelector("[data-tab=agent]")?.click();
    const note = $("#agent-unavailable");
    if (note && !note.hidden) note.scrollIntoView({ block: "nearest" });
  };

  return {
    render,
    profile: () => profile,
    openQuiz,
    // First visit: greet with the quiz, unless a deep link asked for something else.
    maybeGreet: () => { if (!profile && !location.hash) openQuiz(); },
    help: HELP,
  };
}
