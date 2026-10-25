// Florida and Miami programs from florida-programs.json. This list is separate
// from Grants.gov: nothing here is passed to filterGrants or the federal counts.
// unverified_left_out stays in the file and is never shown.

// WHY: every card names its source so a local program cannot be read as a
// Grants.gov record. The researcher specified this label.
export const SOURCE_LABEL = "Florida program";

// WHY: the county page uses the American spelling "Canceled". Matching that
// exact word in the source quote keeps it from being rewritten as "Closed".
const CANCELED_WORD = "Canceled";

// WHY: the closed-program toggle is remembered with the shared store helper
// (private-mode storage must not throw). One key so the Grants tab and the
// For you block stay in agreement.
export const SHOW_CLOSED_KEY = "fl-programs-show-closed";

// WHY: open is accepting on a stated window and rolling is accepting until the
// money runs out, so both come before unclear (no dates) and closed (not
// accepting). A closed program must never sort as if it were open. Unknown
// statuses share the closed rank so they cannot float to the top.
export const STATUS_RANK = { open: 0, rolling: 1, unclear: 2, closed: 3 };

// WHY: closed programs must say Closed and must not be labeled Open.
// Anything that is not a known status falls through to Closed.
const STATUS_TEXT = { open: "Open", rolling: "Rolling", unclear: "Unclear", closed: "Closed" };

// WHY: type technical_assistance is free help, not award money. The verified
// list uses it for SBDC at FIU (fsbdc-fiu), APEX Accelerator at FIU (apex-fiu),
// and Miami-Dade SBE certification (mdc-sbe-cert). A loan stays a loan.
const KIND_BY_TYPE = {
  technical_assistance: { key: "free help", text: "Free help" },
  loan: { key: "loan", text: "Loan" },
  grant: { key: "grant", text: "Grant" },
};

// WHY: a program link must be a real web URL. Rendering anything else as an
// href could navigate without a trustworthy click target.
const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

// WHY: only this geography is for the whole state. City of Miami and
// Miami-Dade entries are local and stay off a non-Miami profile.
const STATEWIDE = "Florida statewide";

// WHY: City of Miami programs sit inside Miami-Dade, so that county's profile
// is the one that should see both local geographies.
const MIAMI_COUNTY = "Miami-Dade";

// WHY: names and official quotes are rendered as text. Escaping keeps a character
// in the verified file from being treated as HTML.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function statusRank(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : STATUS_RANK.closed;
}

export function kindKey(program) {
  return KIND_BY_TYPE[program?.type]?.key || "other";
}

export function statusLabel(program) {
  if (program?.status === "closed" && String(program.source_quote || "").includes(CANCELED_WORD)) return CANCELED_WORD;
  return STATUS_TEXT[program?.status] || STATUS_TEXT.closed;
}

export function safeUrl(url) {
  const raw = String(url || "");
  try {
    const u = new URL(raw);
    if (ALLOWED_PROTOCOLS.has(u.protocol)) return raw;
  } catch { /* not a url */ }
  return "";
}

export function presentProgram(program) {
  const kind = kindKey(program);
  return {
    id: program.id,
    name: program.name,
    kind,
    kindText: KIND_BY_TYPE[program.type]?.text || "Program",
    statusText: statusLabel(program),
    available: program.status === "open" || program.status === "rolling",
    source: SOURCE_LABEL,
    officialUrl: safeUrl(program.official_url),
    verifiedOn: program.verified_on || "",
    deadline: program.deadline || "",
    amount: program.amount || "",
    geography: program.geography || "",
    status: program.status || "",
  };
}

// Stable within a status so the researcher's order holds inside each band.
export function sortPrograms(programs) {
  return programs.map((p, i) => [p, i])
    .sort((a, b) => statusRank(a[0].status) - statusRank(b[0].status) || a[1] - b[1])
    .map(([p]) => p);
}

// WHY: unclear stays on the main list (it is not closed) but only open, rolling,
// and unclear belong there. Closed and unknown statuses go behind the toggle
// so they are not presented as available.
const ACCEPTING = new Set(["open", "rolling", "unclear"]);

export function partitionPrograms(programs) {
  const sorted = sortPrograms(programs);
  return {
    active: sorted.filter((p) => ACCEPTING.has(p.status)),
    closed: sorted.filter((p) => !ACCEPTING.has(p.status)),
  };
}

// The file also carries unverified_left_out. Callers must use this, not the
// whole document, so those rows never reach the page.
export function verifiedPrograms(data) {
  return Array.isArray(data?.grants) ? data.grants : [];
}

export function countByStatus(programs) {
  const counts = { open: 0, rolling: 0, unclear: 0, closed: 0 };
  for (const p of programs) if (Object.prototype.hasOwnProperty.call(counts, p.status)) counts[p.status] += 1;
  return counts;
}

export function statusSummary(programs) {
  const c = countByStatus(programs);
  const help = programs.filter((p) => p.type === "technical_assistance" && p.status === "open").length;
  const loans = programs.filter((p) => p.type === "loan" && (p.status === "open" || p.status === "rolling")).length;
  const extras = [];
  if (help) extras.push(`${help} free help`);
  if (loans) extras.push(`${loans} ${loans === 1 ? "loan" : "loans"}`);
  const open = extras.length ? `${c.open} open (${extras.join(", ")})` : `${c.open} open`;
  return `${open}, ${c.rolling} rolling, ${c.unclear} unclear, ${c.closed} closed`;
}

export function listVerifiedOn(programs) {
  const dates = [...new Set(programs.map((p) => p.verified_on).filter(Boolean))];
  return dates.length === 1 ? dates[0] : "";
}

export function verifiedLine(programs) {
  const date = listVerifiedOn(programs);
  return date ? `Verified on ${date}.` : "";
}

export function fitsProfile(program, profile) {
  if (!profile) return true;
  if (profile.kind === "business" && program.eligibility === "nonprofit") return false;
  if (profile.kind === "nonprofit" && program.eligibility === "small_business") return false;
  const county = profile.county;
  if (county && county !== "outside") {
    const detail = `${program.eligibility_detail || ""} ${program.notes || ""}`;
    const name = county.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`not applicable to ${name}`, "i").test(detail)) return false;
  }
  if (!county || county === MIAMI_COUNTY) return true;
  return program.geography === STATEWIDE;
}

function statusClass(program, statusText) {
  if (statusText === CANCELED_WORD) return "is-canceled";
  if (program.status === "open") return "is-open";
  if (program.status === "rolling") return "is-rolling";
  if (program.status === "unclear") return "is-unclear";
  return "is-closed";
}

export function programCard(program, { compact = false, showVerified = false } = {}) {
  const view = presentProgram(program);
  const kindClass = view.kind === "free help" ? " is-help" : view.kind === "loan" ? " is-loan" : "";
  const verified = showVerified && view.verifiedOn ? `<p class="fl-verified">Verified on ${esc(view.verifiedOn)}</p>` : "";
  const amount = view.amount ? `<p class="fl-amount">${esc(view.amount)}</p>` : "";
  const deadline = view.deadline ? `<p class="fl-deadline">${esc(view.deadline)}</p>` : "";
  const admin = !compact && program.administrator ? `<p class="fl-admin">${esc(program.administrator)}</p>` : "";
  const detail = !compact && program.eligibility_detail ? `<p class="snippet">${esc(program.eligibility_detail)}</p>` : "";
  const notes = !compact && program.notes ? `<p class="fl-notes">${esc(program.notes)}</p>` : "";
  const official = view.officialUrl
    ? `<a class="btn ghost" href="${esc(view.officialUrl)}" target="_blank" rel="noopener noreferrer">Official page ↗</a>`
    : "";
  const extra = compact ? "" : (program.extra_urls || []).map(safeUrl).filter(Boolean)
    .map((href) => `<a class="fl-extra" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Related page</a>`).join("");
  return `<article class="fl-card" data-id="${esc(view.id)}" data-status="${esc(view.status)}" data-available="${view.available ? "true" : "false"}">
    <h3>${esc(view.name)}</h3>
    <div class="meta">
      <span class="fl-status ${statusClass(program, view.statusText)}">${esc(view.statusText)}</span>
      <span class="sep">·</span>
      <span class="fl-kind${kindClass}">${esc(view.kindText)}</span>
      <span class="sep">·</span>
      <span class="fl-source">${esc(view.source)}</span>
      ${view.geography ? `<span class="sep">·</span><span>${esc(view.geography)}</span>` : ""}
    </div>
    ${admin}${deadline}${amount}${detail}${notes}${verified}
    <div class="grant-acts">${official}${extra}</div>
  </article>`;
}

export function renderLists(programs, { compact = false } = {}) {
  const { active, closed } = partitionPrograms(programs);
  const shared = listVerifiedOn(programs);
  const card = (p) => programCard(p, { compact, showVerified: !shared });
  return {
    summary: statusSummary(programs),
    verified: verifiedLine(programs),
    activeHtml: active.map(card).join(""),
    closedHtml: closed.map(card).join(""),
    closedCount: closed.length,
  };
}

export function closedShown(store) {
  return !!store && store.get(SHOW_CLOSED_KEY) === "1";
}

export function toggleClosedShown(store) {
  if (!store) return false;
  const next = closedShown(store) ? "0" : "1";
  store.set(SHOW_CLOSED_KEY, next);
  return next === "1";
}

let pending = null;
export function loadFloridaPrograms() {
  if (!pending) {
    pending = fetch("./florida-programs.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .catch(() => { pending = null; return { meta: {}, grants: [] }; });
  }
  return pending;
}
