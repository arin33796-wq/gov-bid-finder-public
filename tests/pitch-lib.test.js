import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchWorkExamples, pitchMiamiBlurb } from "../pitch-lib.js";

test("the Miami slide names only county work that is in the titles it is given", () => {
  const titles = [
    "Multiple Parks - Swimming Pool Spa and Splashpad Repairs - North",
    "Zoo Miami - Splashpad Repairs",
    "Multiple Marina Construction and Repairs - North of Tamiami Trail",
    "MDSO Headquarters Building Roofing and Waterproofing",
    "MDFR Fire Station 35 New Four-Fold Xt Exterior Doors",
    "Summer Food Service Program",
    "carpool shuttle",
  ];
  assert.deepEqual(pitchWorkExamples(titles), ["parks pool repairs", "marina repairs", "roofing"]);
  assert.deepEqual(pitchWorkExamples([
    "MDFR Fire Station 35 New Four-Fold Xt Exterior Doors",
    "Summer Food Service Program",
  ]), []);
  assert.deepEqual(pitchWorkExamples(["carpool shuttle"]), []);
  assert.deepEqual(pitchWorkExamples([]), []);

  const withBuyer = pitchMiamiBlurb(titles, { namedBuyer: true });
  assert.match(withBuyer, /^On the county's list right now: parks pool repairs, marina repairs and roofing\./);
  assert.match(withBuyer, /The county even names the buyer on work it plans to buy\./);
  assert.doesNotMatch(withBuyer, /fire station|summer food/i);

  const bare = pitchMiamiBlurb(["Streetlight Maintenance"], { namedBuyer: false });
  assert.equal(bare, "Ordinary work a Miami firm can do. Most small businesses never see it.");
  assert.doesNotMatch(bare, /names the buyer/);
});
