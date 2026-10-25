// Copy the Miami slide may show. Pure functions so the tests can lock the rules.

// Short labels for ordinary Miami-Dade work, in the order the slide says them.
// WHY these phrases: each one shortens a title pattern on the county feed
// (parks pools and splashpads, marina repairs, building roofing). A phrase is
// included only when an open title matches, so a rebuilt snapshot cannot leave
// a job on the slide that is not in the file. Fire-station doors and the summer
// food program are separate notices; they are not in this list.
const WORK_RULES = [
  { phrase: "parks pool repairs", re: /\bpool\b|\bsplashpad\b/i },
  { phrase: "marina repairs", re: /\bmarina\b/i },
  { phrase: "roofing", re: /\broof/i },
];

export function pitchWorkExamples(titles, rules = WORK_RULES) {
  const found = [];
  for (const rule of rules) {
    if ([...titles].some((t) => rule.re.test(String(t)))) found.push(rule.phrase);
  }
  return found;
}

function joinPhrases(phrases) {
  if (phrases.length <= 1) return phrases[0] || "";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

// The Miami slide's closing paragraph.
// WHY the buyer sentence is optional: it is true only when a loaded future
// solicitation names a person. If the feed stops doing that, the sentence goes.
export function pitchMiamiBlurb(titles, { namedBuyer = false } = {}) {
  const phrases = pitchWorkExamples(titles);
  const lead = phrases.length
    ? `On the county's list right now: ${joinPhrases(phrases)}. Ordinary work a Miami firm can do.`
    : "Ordinary work a Miami firm can do.";
  const buyer = namedBuyer ? " The county even names the buyer on work it plans to buy." : "";
  return `${lead}${buyer} Most small businesses never see it.`;
}
