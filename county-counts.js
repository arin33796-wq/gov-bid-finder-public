// Per-county counts for the Florida "For you" map. No DOM: the page and the
// tests share this so a shade cannot claim a different total than the tooltip.

// Open means due today or later, the same comparison as countOpen: a notice
// due today stays, and anything earlier is dropped. County names come from
// the caller's countyOf (florida.js). A row with no county is counted in
// `unmapped` and is not given a made-up county.
export function floridaOpportunityCounts(rows, { today, dueOf, isFlorida, countyOf, isMatch }) {
  const open = {};
  const matched = {};
  let unmapped = 0;
  let unmappedMatch = 0;
  for (const row of rows) {
    if (String(dueOf(row) ?? "") < today) continue;
    if (!isFlorida(row)) continue;
    const county = countyOf(row) || "";
    const hit = !!isMatch(row);
    if (!county) {
      unmapped++;
      if (hit) unmappedMatch++;
      continue;
    }
    open[county] = (open[county] || 0) + 1;
    if (hit) matched[county] = (matched[county] || 0) + 1;
  }
  return { open, matched, unmapped, unmappedMatch };
}
