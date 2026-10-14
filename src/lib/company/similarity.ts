/**
 * String similarity for the one job it is trusted with: deciding whether two
 * company names that did NOT match exactly are nonetheless the same company.
 *
 * Jaro–Winkler is chosen for its prefix bias — company names share heads far
 * more than tails ("stripe" / "stripe payments") — but it is only ever used
 * behind a deliberately punishing threshold (see resolve.ts). Telling someone
 * they know a contact at a company where they don't is the failure that destroys
 * this product, so a near-miss must fall through to manual confirmation rather
 * than merge on a guess.
 */

export type FuzzyCandidate = { id: string; nameNorm: string };

/** Jaro–Winkler similarity in [0, 1]; 1 means identical. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const base = jaro(a, b);
  // Winkler bonus for a shared prefix, capped at 4 chars with the standard p=0.1.
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return base + prefix * 0.1 * (1 - base);
}

function jaro(a: string, b: string): number {
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let k = start; k < end; k++) {
      if (bMatched[k] || a[i] !== b[k]) continue;
      aMatched[i] = true;
      bMatched[k] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Half the count of matched characters that appear in a different order.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/**
 * The single best candidate at or above `threshold`, or null when none qualify
 * or the top two are too close to separate. Ambiguity resolves to null on
 * purpose: two plausible merges is a question for the user, not a coin toss.
 */
export function bestFuzzyMatch(
  target: string,
  candidates: readonly FuzzyCandidate[],
  threshold = 0.97,
): FuzzyCandidate | null {
  let best: FuzzyCandidate | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const candidate of candidates) {
    // A JW score >= 0.97 is unreachable across a large length gap, so this skip
    // is a cheap correctness guard as much as a performance one.
    if (Math.abs(candidate.nameNorm.length - target.length) > 3) continue;

    const score = jaroWinkler(target, candidate.nameNorm);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (bestScore < threshold) return null;
  if (bestScore - secondScore < 0.01) return null; // too close to call
  return best;
}
