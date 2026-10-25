import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SOURCE_LABEL, SHOW_CLOSED_KEY, statusRank, sortPrograms, partitionPrograms,
  presentProgram, kindKey, statusLabel, programCard, renderLists, verifiedPrograms,
  countByStatus, statusSummary, listVerifiedOn, fitsProfile, closedShown, toggleClosedShown,
  safeUrl,
} from "../florida-programs.js";

const data = JSON.parse(readFileSync(new URL("../research/fl-programs.json", import.meta.url)));
const byId = (id) => data.programs.find((g) => g.id === id);

test("the data file is the 28 verified programs, unverified rows excluded from the list", () => {
  assert.equal(data.meta.count, 28);
  assert.equal(data.programs.length, 28);
  assert.equal(data.grants, undefined);
  assert.match(data.meta.rechecked, /miami\.gov/);
  assert.match(data.meta.rechecked, /miamidda\.com/);
  assert.equal(verifiedPrograms(data).length, 28);
  assert.deepEqual(verifiedPrograms({ grants: [{ id: "nope" }] }), []);
  assert.equal(verifiedPrograms(data).some((p) => /Job Growth Grant Fund/.test(p.name)), false);
  const urls = data.programs.flatMap((p) => [p.official_url, ...(p.extra_urls || [])]);
  assert.ok(urls.some((u) => u.includes("miami.gov")));
  assert.ok(urls.some((u) => u.includes("miamidda.com")));
  assert.match(byId("fl-ebl-isaias").notes, /Activated per disaster\./);
  assert.doesNotMatch(byId("fl-ebl-isaias").notes, /govbid could surface/);
  assert.match(byId("mdc-sbe-cert").notes, /required for SBE set-aside county contracts/);
  assert.ok(data.unverified_left_out.length > 0);
  assert.deepEqual(countByStatus(data.programs), { open: 8, rolling: 3, unclear: 3, closed: 14 });
  assert.equal(listVerifiedOn(data.programs), "2026-10-25");
});

test("sort puts open, then rolling, then unclear, then closed", () => {
  const shuffled = [
    { id: "c", status: "closed" },
    { id: "o", status: "open" },
    { id: "u", status: "unclear" },
    { id: "r", status: "rolling" },
    { id: "x", status: "mystery" },
  ];
  assert.deepEqual(sortPrograms(shuffled).map((p) => p.id), ["o", "r", "u", "c", "x"]);
  assert.equal(statusRank("mystery"), statusRank("closed"));
  assert.ok(statusRank("closed") > statusRank("unclear"));
  assert.ok(statusRank("unclear") > statusRank("rolling"));
  assert.ok(statusRank("rolling") > statusRank("open"));

  const sorted = sortPrograms(data.programs);
  let last = -1;
  for (const p of sorted) {
    const rank = statusRank(p.status);
    assert.ok(rank >= last, p.id);
    last = rank;
  }
  const parts = partitionPrograms(data.programs);
  assert.equal(parts.active.length, 14);
  assert.equal(parts.closed.length, 14);
  assert.ok(parts.active.every((p) => p.status !== "closed"));
  assert.ok(parts.closed.every((p) => p.status === "closed"));
  assert.equal(parts.active.some((p) => p.status === "unclear"), true);
});

test("closed programs are never labeled or presented as open", () => {
  for (const p of data.programs.filter((g) => g.status === "closed")) {
    const view = presentProgram(p);
    assert.equal(view.available, false, p.id);
    assert.notEqual(view.statusText, "Open", p.id);
    assert.notEqual(view.statusText, "Rolling", p.id);
    assert.match(view.statusText, /^(Closed|Canceled)$/, p.id);
    const html = programCard(p);
    assert.match(html, /data-available="false"/, p.id);
    assert.equal(html.includes('data-available="true"'), false, p.id);
    assert.equal(html.includes("is-open"), false, p.id);
    assert.equal(html.includes("is-rolling"), false, p.id);
    assert.match(html, /class="fl-status is-(?:closed|canceled)">(?:Closed|Canceled)</, p.id);
  }
  const view = renderLists(data.programs);
  assert.equal(view.activeHtml.includes('data-status="closed"'), false);
  assert.equal(view.closedHtml.includes('data-available="true"'), false);
  assert.match(view.closedHtml, /class="fl-status is-closed">Closed</);
});

test("free help entries are labeled free help, not grants", () => {
  for (const id of ["fsbdc-fiu", "apex-fiu", "mdc-sbe-cert"]) {
    const p = byId(id);
    assert.equal(p.status, "open", id);
    assert.equal(p.type, "technical_assistance", id);
    assert.equal(kindKey(p), "free help", id);
    const view = presentProgram(p);
    assert.equal(view.kind, "free help", id);
    assert.equal(view.kindText, "Free help", id);
    assert.equal(view.available, true, id);
    assert.equal(view.statusText, "Open", id);
    const html = programCard(p);
    assert.match(html, /class="fl-kind is-help">Free help</, id);
    assert.doesNotMatch(html, />Grant</, id);
  }
  for (const p of data.programs) {
    if (p.type === "grant") assert.notEqual(kindKey(p), "free help", p.id);
    if (p.type === "technical_assistance") assert.equal(kindKey(p), "free help", p.id);
  }
  const loan = byId("fl-ebl-isaias");
  assert.equal(kindKey(loan), "loan");
  assert.match(programCard(loan), />Loan</);
  assert.doesNotMatch(programCard(loan), />Grant</);
  assert.equal(presentProgram(loan).available, true);
});

test("the Miami-Dade CBO program keeps the word Canceled", () => {
  const p = byId("mdc-cbo");
  assert.equal(p.status, "closed");
  assert.match(p.deadline, /canceled/);
  assert.match(p.source_quote, /Canceled/);
  assert.equal(statusLabel(p), "Canceled");
  const view = presentProgram(p);
  assert.equal(view.statusText, "Canceled");
  assert.equal(view.available, false);
  const html = programCard(p);
  assert.match(html, /class="fl-status is-canceled">Canceled</);
  assert.doesNotMatch(html, /class="fl-status[^"]*">Closed</);
  assert.ok(html.includes(p.deadline));
  assert.equal(html.includes("Cancelled"), false);
});

test("each entry keeps its official link, Florida program label, and verified date", () => {
  const view = renderLists(data.programs);
  assert.equal(view.verified, "Verified on 2026-10-25.");
  assert.equal(view.summary, "8 open (3 free help, 1 loan), 3 rolling, 3 unclear, 14 closed");
  assert.equal(view.activeHtml.includes("Verified on"), false);
  for (const p of data.programs) {
    const html = programCard(p);
    const card = presentProgram(p);
    assert.equal(card.source, SOURCE_LABEL, p.id);
    assert.equal(card.officialUrl, p.official_url, p.id);
    assert.match(html, /Florida program/, p.id);
    assert.match(html, new RegExp(`href="${p.official_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), p.id);
    assert.doesNotMatch(html, /onclick|window\.open/, p.id);
  }
  assert.equal(safeUrl("javascript:alert(1)"), "");
});

test("a shared verified date is shown once; mixed dates are shown per entry", () => {
  const sample = byId("fsbdc-fiu");
  const mixed = renderLists([
    { ...sample, id: "a", verified_on: "2026-10-25" },
    { ...sample, id: "b", verified_on: "2026-10-24" },
  ]);
  assert.equal(mixed.verified, "");
  assert.match(mixed.activeHtml, /Verified on 2026-10-25/);
  assert.match(mixed.activeHtml, /Verified on 2026-10-24/);
});

test("compact cards drop the long detail and a Miami business does not see nonprofit-only or the Isaias loan", () => {
  const sbdc = byId("fsbdc-fiu");
  assert.match(programCard(sbdc), /3\+ employees/);
  assert.match(programCard(sbdc), /Florida SBDC Network/);
  assert.doesNotMatch(programCard(sbdc, { compact: true }), /3\+ employees/);
  assert.doesNotMatch(programCard(sbdc, { compact: true }), /Florida SBDC Network/);

  const miami = { kind: "business", county: "Miami-Dade", trades: ["construction"] };
  assert.equal(fitsProfile(sbdc, miami), true);
  assert.equal(fitsProfile(byId("apex-fiu"), miami), true);
  assert.equal(fitsProfile(byId("mdc-sbe-cert"), miami), true);
  assert.equal(fitsProfile(byId("miami-commercial-facade"), miami), true);
  assert.equal(fitsProfile(byId("ct-ceog"), miami), false);
  assert.equal(fitsProfile(byId("mdc-cbo"), miami), false);
  assert.equal(fitsProfile(byId("fl-ebl-isaias"), miami), false);
  assert.equal(fitsProfile(byId("fl-ebl-isaias"), null), true);

  const broward = { kind: "business", county: "Broward" };
  assert.equal(fitsProfile(byId("miami-commercial-facade"), broward), false);
  assert.equal(fitsProfile(byId("csf-iwt"), broward), true);

  const nonprofit = { kind: "nonprofit", county: "Miami-Dade" };
  assert.equal(fitsProfile(byId("ct-ceog"), nonprofit), true);
  assert.equal(fitsProfile(sbdc, nonprofit), false);
  assert.equal(fitsProfile(byId("seopw-public-art"), nonprofit), true);

  const mine = data.programs.filter((p) => fitsProfile(p, miami));
  const listed = renderLists(mine, { compact: true });
  assert.equal(listed.activeHtml.includes('data-status="closed"'), false);
  assert.match(listed.activeHtml, /Free help/);
  assert.equal(statusSummary(mine).startsWith("7 open (3 free help)"), true);
});

test("the closed toggle stays off until the store says otherwise", () => {
  const mem = new Map();
  const store = { get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, v) };
  assert.equal(closedShown(store), false);
  assert.equal(closedShown(null), false);
  assert.equal(toggleClosedShown(null), false);
  assert.equal(toggleClosedShown(store), true);
  assert.equal(store.get(SHOW_CLOSED_KEY), "1");
  assert.equal(closedShown(store), true);
  assert.equal(toggleClosedShown(store), false);
});
