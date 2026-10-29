import type { Category, Priority } from '../db/enums.js';

/**
 * Deterministic keyword rules. Two jobs:
 *  1. Fallback classifier when the LLM is unavailable (so tickets are never "unclassified" for long).
 *  2. Safety floor: strong urgency signals can raise — never lower — the LLM's priority.
 */

const CATEGORY_RULES: [Category, RegExp][] = [
  // Bio/description update requests are General Inquiry per BookLeaf's sample table — check first.
  ['GENERAL_INQUIRY', /\b(update|change|edit|modify)\b.{0,40}\b(bio|description|photo|blurb)\b/i],
  ['ISBN_METADATA', /\bisbn\b|imprint|wrong (book|title|author)( name)? (on|in|linked)|metadata (error|issue|wrong|mismatch)/i],
  ['ROYALTY_PAYMENTS', /royalt|payout|payment|paid|bank (account|details|transfer)|earning|commission|money/i],
  ['PRINTING_QUALITY', /print(ing)? quality|misprint|blurr?y|binding|misalign|defect|torn|smudge|colou?r (issue|inconsisten)|reprint|author cop/i],
  ['DISTRIBUTION_AVAILABILITY', /unavailable|out of stock|not (showing|listed|available)|amazon|flipkart|listing|distribution|buy (it|my book)/i],
  ['BOOK_STATUS_PRODUCTION', /typesetting|proofread|cover design|production|manuscript|stage|when will (it|my book)|still in|status of my book|editing/i],
];

export function rulesCategory(text: string): Category {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'GENERAL_INQUIRY';
}

const CRITICAL = /(\d+|several|many|six|five|four)\s+(months?|quarters?)\b.*(no|not|never|haven'?t|without).*(royalt|pay)|(no|not|never|haven'?t).*(royalt|pay).*(\d+|several|six|five|four)\s+(months?|quarters?)|legal action|lawyer|fraud|scam|copyright (theft|infringement)|plagiar/i;
const HIGH = /\bisbn\b.*(wrong|different|duplicate|mismatch|incorrect)|(wrong|different|duplicate|mismatch|incorrect).*\bisbn\b|misprint|defect|blurr?y|binding|unavailable|out of stock|overdue|not received|urgent|asap|delay/i;
const LOW = /update (my )?(author )?bio|change (my )?(photo|bio|description)|how (do|can) i|is it possible|general question|curious/i;

export function rulesPriority(text: string, category: Category): Priority {
  if (CRITICAL.test(text)) return 'CRITICAL';
  if (HIGH.test(text) || category === 'ISBN_METADATA' && /error|wrong|different|duplicate/i.test(text)) return 'HIGH';
  if (LOW.test(text) || category === 'GENERAL_INQUIRY') return 'LOW';
  return 'MEDIUM';
}

const RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Raise priority to the rules floor only for strong (CRITICAL/HIGH) signals. */
export function applyPriorityFloor(llm: Priority, text: string, category: Category): Priority {
  const floor = rulesPriority(text, category);
  if ((floor === 'CRITICAL' || floor === 'HIGH') && RANK[floor] < RANK[llm]) return floor;
  return llm;
}

export const priorityRank = (p: Priority | null | undefined) => (p ? RANK[p] : 4);
