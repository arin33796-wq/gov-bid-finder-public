import { test } from "node:test";
import assert from "node:assert/strict";
import { floridaOpportunityCounts } from "../county-counts.js";
import { countyOf } from "../florida.js";

const TODAY = "2026-10-25";

function count(rows) {
  return floridaOpportunityCounts(rows, {
    today: TODAY,
    dueOf: (r) => r.due,
    isFlorida: (r) => r.state === "FL",
    countyOf: (r) => countyOf(r.city, r.source),
    isMatch: (r) => r.match,
  });
}

test("floridaOpportunityCounts keeps due-today, drops yesterday, and ignores other states", () => {
  const got = count([
    { due: "2026-10-25", state: "FL", city: "Miami", source: "sam.gov", match: true },
    { due: "2026-10-24", state: "FL", city: "Miami", source: "sam.gov", match: true },
    { due: "2026-11-01", state: "GA", city: "Atlanta", source: "sam.gov", match: true },
    { due: "2026-11-01", state: "FL", city: "Tampa", source: "sam.gov", match: false },
  ]);
  assert.equal(got.open["Miami-Dade"], 1);
  assert.equal(got.matched["Miami-Dade"], 1);
  assert.equal(got.open["Hillsborough"], 1);
  assert.equal(got.matched["Hillsborough"], undefined);
  assert.equal(got.open["Fulton"], undefined);
  assert.equal(got.unmapped, 0);
});

test("trade matches are a subset of open Florida notices, by real county", () => {
  const got = count([
    { due: "2026-11-01", state: "FL", city: "Miami", source: "sam.gov", match: true },
    { due: "2026-11-02", state: "FL", city: "Homestead", source: "sam.gov", match: false },
    { due: "2026-11-03", state: "FL", city: "Doral", source: "miami-dade", match: true },
    { due: "2026-11-04", state: "FL", city: "", source: "miami-dade", match: false },
    { due: "2026-11-05", state: "FL", city: "Nowhere", source: "sam.gov", match: true },
    { due: "2026-11-06", state: "FL", city: "", source: "sam.gov", match: false },
    { due: "2026-10-01", state: "FL", city: "Miami", source: "sam.gov", match: true },
  ]);
  // Miami, Homestead, Doral, and a blank city on the county feed are Miami-Dade.
  // The closed Miami row is not. Nowhere and a blank sam.gov city are unmapped.
  assert.equal(got.open["Miami-Dade"], 4);
  assert.equal(got.matched["Miami-Dade"], 2);
  assert.equal(got.unmapped, 2);
  assert.equal(got.unmappedMatch, 1);
  const openTotal = Object.values(got.open).reduce((a, b) => a + b, 0) + got.unmapped;
  const matchTotal = Object.values(got.matched).reduce((a, b) => a + b, 0) + got.unmappedMatch;
  assert.equal(openTotal, 6);
  assert.equal(matchTotal, 3);
  for (const county of Object.keys(got.matched)) assert.ok(got.matched[county] <= got.open[county]);
  assert.equal(got.open["Nowhere"], undefined);
});
