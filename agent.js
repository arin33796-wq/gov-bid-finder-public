// The govbid agent: Claude, running on the viewer's own account through the
// artifact `sample` capability, with page functions as its tools. It searches the
// loaded contracts, opens the promising ones, checks competition and expiring
// work, saves picks to the shortlist, and proposes buyer emails. Anything that
// leaves the page (a Gmail draft) waits for the person to press a button.

import { profileToText, filterGrants, stemMatcher } from "./lib.js?v=4";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// WHY these caps: tool results go back to Claude every round and each round is
// paid on the viewer's account, so results stay small (the platform limit is 32 KB).
const MAX_RESULTS = 8;
const MAX_COMPANIES = 6;

// Minimal, safe Markdown for the agent's answer: escape first, then bold, bullets, paragraphs.
function renderAnswer(text) {
  const lines = esc(text).split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^#{1,4}\s+/.test(line)) html += `<h4>${line.replace(/^#{1,4}\s+/, "")}</h4>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}

export function initAgent(ctx) {
  const { F, R } = ctx;
  const log = $("#agent-log"), out = $("#agent-answer"), actions = $("#agent-actions"), status = $("#agent-status");
  const runBtn = $("#agent-run"), stopBtn = $("#agent-stop"), box = $("#agent-input");
  let sample = null, mcp = null, ctl = null, toolsOk = false;

  document.querySelectorAll("#agent-examples button").forEach((b) => b.onclick = () => { box.value = b.dataset.text; box.focus(); });

  const step = (icon, html) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ico">${icon}</span><span>${html}</span>`;
    log.appendChild(li);
    li.scrollIntoView({ block: "nearest" });
    return li;
  };

  // ---- tools: plain page functions Claude may call ----
  const compact = (r) => ({
    id: r[F.ID], title: r[F.TITLE].slice(0, 140), agency: ctx.agencyName(ctx.dept(r)), type: ctx.type(r),
    due: r[F.DUE], days_left: ctx.daysLeft(r[F.DUE]),
    place: [r[F.CITY], r[F.STATE]].filter(Boolean).join(", ") || "not listed",
    county: r[F.STATE] === "FL" ? (ctx.countyOf(r[F.CITY], ctx.source(r)) || "unknown") : undefined,
    industry: ctx.naicsName(r[F.NAICS]) || r[F.NAICS] || "not listed",
    typical_award: r[F.VALUE] ? ctx.money(r[F.VALUE]) : "unknown",
    simplicity: r[F.SIMP], set_aside: ctx.setaside(r) || "open to all",
    buyer_named: !!r[F.EMAIL],
  });
  const findRow = (id) => ctx.rows.find((r) => r[F.ID] === String(id));

  const tools = [
    {
      name: "search_contracts",
      description: "Search open US government contracts. Matches any of the keywords (use short word stems like 'paint', 'janitor', 'hvac') against title, description and industry. Returns the best matches ranked by value and simplicity, plus the total count.",
      inputSchema: { type: "object", properties: {
        keywords: { type: "array", items: { type: "string" }, description: "1-5 lowercase word stems" },
        state: { type: "string", description: "Two-letter state code for the place of performance, e.g. FL. Omit for nationwide." },
        county: { type: "string", description: "A Florida county, e.g. Miami-Dade or Broward. Implies state FL. Includes Miami-Dade County's own bids." },
        set_aside_only: { type: "boolean", description: "Only contracts reserved for small or certified businesses" },
        min_days_left: { type: "number", description: "Skip contracts due sooner than this many days (default 3)" },
      }, required: ["keywords"] },
      execute(input) {
        const kws = (Array.isArray(input.keywords) ? input.keywords : [input.keywords]).map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 5);
        if (!kws.length) throw new Error("Give at least one keyword.");
        const county = input.county ? String(input.county).replace(/\s*county$/i, "").trim() : "";
        const state = county ? "FL" : input.state ? String(input.state).toUpperCase().slice(0, 2) : "";
        const minDays = Number.isFinite(Number(input.min_days_left)) ? Number(input.min_days_left) : 3;
        const today = ctx.localISODate();
        const fits = stemMatcher(kws);
        const hits = [];
        for (let i = 0; i < ctx.rows.length; i++) {
          const r = ctx.rows[i];
          if (r[F.DUE] < today || !r[F.US]) continue;
          if (state && r[F.STATE] !== state) continue;
          if (county && ctx.countyOf(r[F.CITY], ctx.source(r)).toLowerCase() !== county.toLowerCase()) continue;
          if (input.set_aside_only && !ctx.setaside(r)) continue;
          if (ctx.daysLeft(r[F.DUE]) < minDays) continue;
          if (!fits(ctx.hay[i])) continue;
          hits.push(r);
        }
        hits.sort((a, b) => (b[F.SCORE] || 0) - (a[F.SCORE] || 0) || a[F.DUE].localeCompare(b[F.DUE]));
        const seen = new Set(), top = [];
        for (const r of hits) { if (seen.has(r[F.TITLE])) continue; seen.add(r[F.TITLE]); top.push(compact(r)); if (top.length >= MAX_RESULTS) break; }
        step("⌕", `Searched <b>${esc(kws.join(", "))}</b> ${county ? "in " + esc(county) + " County" : state ? "in " + esc(ctx.stateName(state)) : "nationwide"}: <b>${hits.length}</b> open`);
        return { total_matches: hits.length, results: top };
      },
    },
    {
      name: "get_contract",
      description: "Full details of one contract by id: description, deadline, set-aside, place, buyer (contracting officer) name and email, and the official link.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute(input) {
        const r = findRow(input.id);
        if (!r) throw new Error("No contract with that id. Use an id from search_contracts.");
        step("◧", `Read <b>${esc(r[F.TITLE].slice(0, 70))}</b>`);
        return { ...compact(r), office: r[F.SUBTIER] || "", posted: r[F.POSTED], naics: r[F.NAICS],
          description: r[F.SNIP] || "No description in the feed; details are in the attachments on the official notice.",
          buyer_name: r[F.CNAME] || "", buyer_email: r[F.EMAIL] || "", link: r[F.LINK] };
      },
    },
    {
      name: "find_competitors",
      description: "Companies that have already won federal contracts in this contract's industry code, with location, number of awards and average award. Use to judge competition or find teaming partners.",
      inputSchema: { type: "object", properties: { contract_id: { type: "string" } }, required: ["contract_id"] },
      execute(input) {
        const r = findRow(input.contract_id);
        if (!r) throw new Error("No contract with that id.");
        const list = (ctx.vendors()[r[F.NAICS]] || []).slice(0, MAX_COMPANIES);
        step("◎", `Checked who already wins <b>${esc(ctx.naicsName(r[F.NAICS]) || "this work")}</b>: ${list.length} firms on record`);
        return list.map((v) => ({ name: v[0], place: [v[1], v[2]].filter(Boolean).join(", ") || "not listed", awards: v[3], average_award: ctx.money(v[4]), last_award: v[5] }));
      },
    },
    {
      name: "find_expiring_contracts",
      description: "Federal maintenance and repair contracts ending within a year, with the company holding each today. A small firm can prepare to compete when these are re-bid.",
      inputSchema: { type: "object", properties: {
        keywords: { type: "array", items: { type: "string" }, description: "Word stems matched against the trade and description" },
        state: { type: "string", description: "Two-letter state code" },
      }, required: ["keywords"] },
      async execute(input) {
        const rows = await ctx.loadRenewals();
        const kws = (Array.isArray(input.keywords) ? input.keywords : [input.keywords]).map((k) => String(k).toLowerCase());
        const state = input.state ? String(input.state).toUpperCase().slice(0, 2) : "";
        const yearOut = ctx.addDaysISO(365);
        const hits = rows.filter((r) => r[R.END] <= yearOut && (!state || r[R.STATE] === state)
          && kws.some((k) => `${r[R.TRADE]} ${r[R.DESC]}`.toLowerCase().includes(k)));
        hits.sort((a, b) => a[R.END].localeCompare(b[R.END]));
        step("↻", `Looked for expiring contracts: <b>${hits.length}</b> ending within a year`);
        return hits.slice(0, MAX_RESULTS).map((r) => ({ trade: r[R.TRADE], ends: r[R.END], value: ctx.money(r[R.AMT]), held_by: r[R.WHO] || "unknown", agency: r[R.AGENCY], state: r[R.STATE], description: String(r[R.DESC]).slice(0, 120) }));
      },
    },
    {
      name: "search_grants",
      description: "Search open federal grants (from Grants.gov) that small businesses, nonprofits or individuals may apply for. Unrestricted grants are included for those groups. Research grants for labs are excluded. Returns title, agency, close date, award ceiling and link.",
      inputSchema: { type: "object", properties: {
        keywords: { type: "array", items: { type: "string" }, description: "1-4 words about their work or mission, e.g. 'food', 'youth', 'workforce'" },
        who: { type: "string", enum: ["small_business", "nonprofit", "individual", "unrestricted", "other"], description: "Who is applying. other means the listing states eligibility; do not treat it as a small business grant." },
      }, required: ["keywords"] },
      async execute(input) {
        const all = await ctx.grants();
        const kws = (Array.isArray(input.keywords) ? input.keywords : [input.keywords]).map((k) => String(k).toLowerCase()).filter(Boolean).slice(0, 4);
        const who = ["small_business", "nonprofit", "individual", "unrestricted", "other"].includes(input.who) ? input.who : "";
        const pool = filterGrants(all, { who, today: ctx.localISODate() });
        const fits = stemMatcher(kws);
        const hits = pool.filter((g) => fits(`${g.title} ${g.desc} ${g.categories.join(" ")}`.toLowerCase()));
        step("$", `Searched grants for <b>${esc(kws.join(", "))}</b>: <b>${hits.length}</b> open`);
        return { total_matches: hits.length, results: hits.slice(0, 6).map((g) => ({ title: g.title.slice(0, 140), agency: g.agency, closes: g.closes || "not set (forecast)", award_ceiling: g.ceiling ? ctx.money(g.ceiling) : "not stated", link: g.link })) };
      },
    },
    {
      name: "save_to_shortlist",
      description: "Save a contract to the user's shortlist so they can come back to it. Use for your top picks.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute(input) {
        const r = findRow(input.id);
        if (!r) throw new Error("No contract with that id.");
        ctx.save(r[F.ID]);
        step("★", `Saved <b>${esc(r[F.TITLE].slice(0, 60))}</b> to your shortlist`);
        return "Saved.";
      },
    },
    {
      name: "propose_email",
      description: "Show the user a drafted email to a contract's buyer for their approval. Nothing is sent: the user can edit it, copy it, or save it as a Gmail draft. Use once for your top pick.",
      inputSchema: { type: "object", properties: {
        contract_id: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain text. Sign off with [Your name] and [Company] placeholders." },
      }, required: ["contract_id", "subject", "body"] },
      execute(input) {
        const r = findRow(input.contract_id);
        if (!r) throw new Error("No contract with that id.");
        if (!r[F.EMAIL]) throw new Error("This notice names no buyer email. Pick a contract where buyer_named is true.");
        addEmailCard(r, String(input.subject || ""), String(input.body || ""));
        step("✉", `Drafted an email to <b>${esc(r[F.CNAME] || r[F.EMAIL])}</b>, waiting for your approval`);
        return "Shown to the user for approval. Not sent.";
      },
    },
  ];

  // ---- action cards: the human-approval step ----
  function addEmailCard(r, subject, body) {
    const card = document.createElement("div");
    card.className = "card action-card";
    const n = actions.children.length;
    card.innerHTML = `
      <div class="action-head"><span class="badge">Needs your approval</span><span class="small muted">Nothing has been sent</span></div>
      <h4>${esc(r[F.TITLE])}</h4>
      <label for="ac-to-${n}">To</label><input id="ac-to-${n}" value="${esc(r[F.EMAIL])}" readonly>
      <label for="ac-su-${n}">Subject</label><input id="ac-su-${n}" value="${esc(subject)}">
      <label for="ac-bo-${n}">Message</label><textarea id="ac-bo-${n}">${esc(body)}</textarea>
      <div class="action-btns">
        <button type="button" class="btn act-gmail">Save as Gmail draft</button>
        <button type="button" class="btn ghost act-copy">Copy email</button>
        <button type="button" class="btn ghost act-open">Open the notice</button>
      </div>
      <div class="small action-note" aria-live="polite"></div>`;
    actions.appendChild(card);
    const note = card.querySelector(".action-note");
    const fields = () => ({ to: r[F.EMAIL], su: card.querySelector(`#ac-su-${n}`).value, bo: card.querySelector(`#ac-bo-${n}`).value });
    card.querySelector(".act-open").onclick = () => ctx.openDetail(r[F.ID]);
    card.querySelector(".act-copy").onclick = (e) => {
      const f = fields();
      ctx.copyAndTick(e.currentTarget, `To: ${f.to}\nSubject: ${f.su}\n\n${f.bo}`, () => {});
    };
    const gmailBtn = card.querySelector(".act-gmail");
    if (!mcp) gmailBtn.hidden = true;
    gmailBtn.onclick = async () => {
      const f = fields();
      gmailBtn.disabled = true; note.textContent = "Saving to Gmail…";
      try {
        const res = await mcp.callTool("Gmail", "create_draft", { to: [f.to], subject: f.su, body: f.bo });
        const url = res?.payload?.viewUrl;
        note.innerHTML = `Saved as a draft in your Gmail. Review it there and press send when ready.${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">Open draft</a>` : ""}`;
        gmailBtn.textContent = "✓ Draft saved";
      } catch (e) {
        gmailBtn.disabled = false;
        note.textContent = {
          server_not_connected: "Gmail isn't connected. Add it in claude.ai Settings → Connectors, or use Copy email.",
          needs_reauth: "Gmail needs reconnecting in claude.ai Settings → Connectors. Copy email works meanwhile.",
          approval_required: "Saving to Gmail needs your approval. Press the button again and allow it when Claude asks.",
          not_in_manifest: "Gmail isn't allowed for this page. Use Copy email instead.",
          blocked_by_policy: "Your organization blocks this. Use Copy email instead.",
        }[e?.code] || "Couldn't save the draft. It may still have been created, so check Gmail before trying again.";
      }
    };
  }

  // ---- run ----
  const INSTRUCTIONS = (profile) => `You are govbid's contracting agent, built for Miami and South Florida. You work for a small business or community group and find government contracts and grants it can realistically win, then take the first step toward winning one.

Today is ${ctx.localISODate()}. Contract data is from ${ctx.builtOn}.

The business, in the owner's words:
"""
${profile.slice(0, 2000)}
"""

How to work:
1. Pick 2-4 word stems for their trade. If they are in Florida, call search_contracts with their county first (this includes Miami-Dade County's own bids), then state FL, then nationwide only if Florida has fewer than 3 good fits. Make independent tool calls in the same round, and call search_grants in that first round too.
2. Call get_contract on the 3 most promising results in one round. Match the kind of work, not just the word: a building painter is not an aircraft or ship coatings shop, and a landscaper is not a land survey firm. Skip results that need different equipment, licenses or facilities. Prefer: work in or near their state (say so when a pick needs travel), buyer_named true, simplicity 55 or more, 7+ days left, a typical award the business can handle, and a set-aside they qualify for. A set-aside for a certification they did not mention (8(a), HUBZone, SDVOSB, WOSB) rules a contract out. If nothing truly fits, say so plainly and lean on expiring contracts instead.
3. For your top pick, call find_competitors. Call find_expiring_contracts once with their trade and state.
4. Call save_to_shortlist for each pick, and propose_email once for your best pick with buyer_named true (many county bids name no buyer; if no pick does, skip the email and point them to the bid's link instead): a short, plain email to the buyer that introduces the business in one line and asks what decides whether to bid (is the full package posted, is there a site visit, bonding or insurance requirements, is there an incumbent). No flattery, under 150 words.

Answer in the language the owner wrote in (many Miami owners write in Spanish or Haitian Creole), keeping contract titles, ids and emails exactly as the tools returned them; write the buyer email in English, because county and federal buyers work in English, and say so in one line.

Then answer in under 220 words, plain text with **bold** and "- " bullets only:
- One line on what you searched and how many open contracts matched.
- Your picks: **title**, deadline, typical award, and one line on why it fits.
- One expiring contract worth preparing for, if any.
- Up to two grants they could apply for, if any fit.
- Say the email is waiting for their approval below.
Only mention contracts that came back from the tools. Never invent ids, numbers or emails.`;

  async function run() {
    const profile = box.value.trim();
    if (!sample) { status.textContent = "Still connecting to Claude. Try again in a moment."; return; }
    if (!profile) { status.textContent = "Describe your business first: trade, city, size, any certifications."; box.focus(); return; }
    ctl?.abort();
    ctl = new AbortController();
    log.innerHTML = ""; out.innerHTML = ""; actions.innerHTML = ""; status.textContent = "";
    runBtn.disabled = true; stopBtn.hidden = false;
    $("#agent-work").hidden = false;
    const thinking = step('<span class="spin"></span>', "Thinking about your business…");
    try {
      await sample(INSTRUCTIONS(profile), {
        tools, signal: ctl.signal,
        modelTier: $("#agent-deep").checked ? "default" : "quick",
        onText: ({ text }) => { thinking.remove(); out.innerHTML = renderAnswer(text); },
      });
      thinking.remove();
      step("✓", "Done");
    } catch (e) {
      thinking.remove();
      if (e?.text) out.innerHTML = renderAnswer(e.text);
      if (e?.code === "cancelled") step("■", "Stopped");
      else if (e?.code === "not_granted" || e?.code === "sampling_disabled") { status.textContent = "The agent needs permission to use Claude. Reload the page and allow it when asked."; }
      else if (e?.code === "rate_limited") status.textContent = "Claude is busy or your usage limit was reached. Try again in a minute.";
      else if (e?.code === "refused") { out.innerHTML = ""; status.textContent = "Claude declined that request. Describe the business differently and try again."; }
      else status.textContent = "The agent was interrupted. Press Run again to retry.";
    } finally {
      runBtn.disabled = false; stopBtn.hidden = true;
    }
  }
  const setProfile = (p) => { if (p) box.value = profileToText(p); };
  setProfile(ctx.profile?.());
  runBtn.onclick = run;
  stopBtn.onclick = () => ctl?.abort();

  // The agent needs Claude. Outside a Claude viewer (for example the public GitHub
  // Pages copy) explain where it runs instead of showing a dead button.
  (async () => {
    const claude = window.claude;
    sample = claude ? await claude.use("sample").catch(() => null) : null;
    mcp = claude ? await claude.use("mcp").catch(() => null) : null;
    const limits = sample ? await sample.limits().catch(() => null) : null;
    toolsOk = !!limits?.tools;
    if (!sample || !toolsOk) {
      runBtn.disabled = true;
      $("#agent-unavailable").hidden = false;
    }
  })();
  return { setProfile };
}
