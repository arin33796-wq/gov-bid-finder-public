// The Grants tab: federal grants open to small businesses, nonprofits and
// individuals, from grants.json (built daily from Grants.gov).
import { filterGrants } from "./lib.js?v=3";
import { loadFloridaPrograms, renderLists, verifiedPrograms, closedShown, toggleClosedShown } from "./florida-programs.js?v=1";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WHO = { small_business: "Small businesses", nonprofit: "Nonprofits", individual: "Individuals" };
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

  // Florida programs paint into their own nodes. run() never reads or writes them,
  // so Grants.gov filters and #g-count stay federal-only.
  function paintFlorida(data) {
    const programs = verifiedPrograms(data);
    const show = closedShown(ctx.store);
    const view = renderLists(programs);
    const lead = $("#fl-programs-lead");
    if (!lead) return;
    lead.textContent = programs.length
      ? `${view.verified ? view.verified + " " : ""}Separate from the Grants.gov list below, and not included in those counts or filters.`
      : "Florida programs could not be loaded.";
    $("#fl-programs-count").textContent = programs.length ? `${programs.length} programs: ${view.summary}.` : "";
    $("#fl-programs-list").innerHTML = view.activeHtml || (programs.length ? '<div class="empty small">No programs are accepting applications right now.</div>' : "");
    const closedHost = $("#fl-programs-closed");
    const toggle = $("#fl-closed-toggle");
    toggle.hidden = view.closedCount === 0;
    toggle.textContent = show ? "Hide closed programs" : `Show ${view.closedCount} closed programs`;
    toggle.setAttribute("aria-expanded", show ? "true" : "false");
    closedHost.innerHTML = view.closedHtml;
    closedHost.hidden = !show || view.closedCount === 0;
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
      $("#fl-closed-toggle").onclick = () => {
        toggleClosedShown(ctx.store);
        loadFloridaPrograms().then(paintFlorida);
      };
    }
    run(1);
    loadFloridaPrograms().then(paintFlorida);
  }

  return { init, load, grantCard, all: () => GRANTS, setWho: (w) => { $("#g-who").value = w; } };
}
