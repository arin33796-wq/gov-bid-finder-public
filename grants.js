// The Grants tab: federal grants from grants.json (built daily from Grants.gov).
// Unrestricted grants are open to any applicant. "Others" only means the
// listing itself says who may apply.
import { filterGrants } from "./lib.js?v=4";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WHO = {
  small_business: "Small businesses",
  nonprofit: "Nonprofits",
  individual: "Individuals",
  // WHY not "Small businesses": code 99 is open to any applicant type. The tag
  // has to say that, or a small-business filter looks like the listing named them.
  unrestricted: "Unrestricted",
  // WHY "Others": code 25 means "see the listing", not a group we can vouch for.
  other: "Others",
};
// Grants.gov's catch-all category label runs to a sentence; shorten it on screen.
const catLabel = (c) => c.startsWith("Other (see text") ? "Other" : c;

export function initGrants(ctx) {
  let GRANTS = [], loaded = null, page = 1, hits = [];
  const load = () => loaded ??= fetch("./grants.json").then((r) => r.json()).then((d) => { GRANTS = d.grants || []; return GRANTS; }).catch(() => { loaded = null; return []; });

  function grantCard(g) {
    const days = g.closes ? ctx.daysLeft(g.closes) : null;
    const when = g.status === "forecast" && !g.closes ? '<span class="due">expected soon</span>'
      : days === 0 ? '<span class="due soon">closes today</span>'
      : `<span class="due ${days <= 7 ? "soon" : days <= 21 ? "warn" : ""}">${days} day${days === 1 ? "" : "s"} left</span>`;
    const amount = g.ceiling ? `up to ${ctx.money(g.ceiling)}` : "";
    return `<article class="opp grant" style="padding-right:16px">
      <h3>${esc(g.title)}</h3>
      <div class="meta">${when} <span class="sep">·</span> <span>${esc(g.agency)}</span>
        ${g.status === "forecast" ? '<span class="tag">forecast</span>' : ""}
        ${amount ? `<span class="tag money">${esc(amount)}</span>` : ""}
        ${g.eligible.map((e) => `<span class="tag setaside">${esc(WHO[e] || e)}</span>`).join("")}
        ${g.categories.slice(0, 2).map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}
      </div>
      ${g.desc ? `<div class="snippet">${esc(g.desc)}</div>` : ""}
      <div class="grant-acts"><a class="btn ghost" href="${esc(g.link)}" target="_blank" rel="noopener">See it on Grants.gov ↗</a>${g.contact ? `<span class="small muted">Questions: ${esc(g.contact)}</span>` : ""}</div>
    </article>`;
  }

  async function run(p = 1) {
    await load();
    if (p === 1) {
      hits = filterGrants(GRANTS, { who: $("#g-who").value, category: $("#g-cat").value, q: $("#g-q").value, hideResearch: $("#g-research").checked, today: ctx.localISODate() });
      if ($("#g-sort").value === "amount") hits = [...hits].sort((a, b) => (b.ceiling || 0) - (a.ceiling || 0));
      $("#g-list").innerHTML = "";
    }
    page = p;
    $("#g-count").textContent = hits.length ? `${hits.length.toLocaleString()} grants — showing ${Math.min(p * 20, hits.length)}` : "";
    if (!hits.length) { $("#g-list").innerHTML = '<div class="empty">No open grants match. Try another category or clear the search.</div>'; $("#g-more").hidden = true; return; }
    $("#g-list").insertAdjacentHTML("beforeend", hits.slice((p - 1) * 20, p * 20).map(grantCard).join(""));
    $("#g-more").hidden = p * 20 >= hits.length;
  }

  let wired = false;
  async function init() {
    await load();
    if (!wired) {
      wired = true;
      const cats = [...new Set(GRANTS.flatMap((g) => g.categories))].sort();
      $("#g-cat").insertAdjacentHTML("beforeend", cats.map((c) => `<option value="${esc(c)}">${esc(catLabel(c))}</option>`).join(""));
      ["#g-who", "#g-cat", "#g-sort", "#g-research"].forEach((s) => $(s).onchange = () => run(1));
      $("#g-q").addEventListener("input", () => { clearTimeout(window._gq); window._gq = setTimeout(() => run(1), 220); });
      $("#g-more").onclick = () => run(page + 1);
    }
    run(1);
  }

  return { init, load, grantCard, all: () => GRANTS, setWho: (w) => { $("#g-who").value = w; } };
}
