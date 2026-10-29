import type { Category } from '../db/enums.js';

/**
 * BookLeaf Knowledge Base, split into sections so each prompt only carries what it needs.
 * Sending one category section (~150 tokens) instead of the full KB (~1,100 tokens)
 * cuts draft-prompt size by roughly 70%.
 */

export const CATEGORY_LABELS: Record<Category, string> = {
  ROYALTY_PAYMENTS: 'Royalty & Payments',
  ISBN_METADATA: 'ISBN & Metadata Issues',
  PRINTING_QUALITY: 'Printing & Quality',
  DISTRIBUTION_AVAILABILITY: 'Distribution & Availability',
  BOOK_STATUS_PRODUCTION: 'Book Status & Production Updates',
  GENERAL_INQUIRY: 'General Inquiry',
};

export const COMPANY_OVERVIEW = `BookLeaf Publishing is a self-publishing company operating in India and the US.
Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid, with marketing & distribution add-ons).
BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management.
In-house printing facility and warehouse in Delhi; print partners Repro India and Epitome Books.`;

export const TONE_GUIDELINES = `- Empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern BEFORE giving solutions.
- Be specific: use the actual numbers, dates and statuses provided. No vague reassurance.
- If BookLeaf is at fault (delayed royalty, ISBN error), own it directly. No corporate deflection.
- If escalation/investigation is needed, give a clear timeline (e.g. "within 48 hours").
- Never blame the author, even if a delay is on their side — frame it collaboratively.
- Always end with a clear next step for the author and/or the BookLeaf team.`;

export const KB_SECTIONS: Record<Category, string> = {
  ROYALTY_PAYMENTS: `ROYALTY POLICY
- 80/20 split: 80% of net profit per book to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold ₹1,000; smaller balances roll over to the next quarter.
- Payouts go by bank transfer to the account linked in the author's dashboard.
- Authors can see a detailed royalty breakdown (sales per platform) in their dashboard.`,

  ISBN_METADATA: `ISBN POLICY
- Every BookLeaf book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint.
- Authors wanting an ISBN under their own imprint must obtain it independently.
- ISBN errors (duplicate, wrong book linked, mismatch between listing and print) are HIGH PRIORITY and escalated to the production team; resolution timeline 48 hours.
METADATA
- Metadata updates (description, bio etc.) can be submitted via the dashboard or by emailing the BookLeaf team; changes reflect on platforms within 3–5 business days.`,

  PRINTING_QUALITY: `PRINTING & QUALITY
- In-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a FREE reprint after verification. The author may need to share photos of the defective copy. Reprint timeline 5–7 business days.`,

  DISTRIBUTION_AVAILABILITY: `DISTRIBUTION & AVAILABILITY
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- "Unavailable" on a platform usually means a stock sync issue; BookLeaf can trigger a re-sync, live again within 24–48 hours.`,

  BOOK_STATUS_PRODUCTION: `PRODUCTION STAGES
Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are emailed at each stage.
- Common delays: Cover Design (waiting for author approval) and Proofreading (revision rounds).
- After publication, listings go live in 7–10 business days.`,

  GENERAL_INQUIRY: `GENERAL
- Metadata updates (book description, author bio) can be submitted via the dashboard or by emailing the BookLeaf team; changes reflect within 3–5 business days.
- Packages: Standard Free and Bestseller Breakthrough (premium with marketing & distribution add-ons).
- Books are sold on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.`,
};

/** One calibrated example per category (from BookLeaf's sample table) — few-shot guidance, not templates. */
export const EXAMPLES: Record<Category, { query: string; guidance: string }> = {
  ROYALTY_PAYMENTS: {
    query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
    guidance: 'Acknowledge the frustration. Explain the quarterly cycle and 45-day payout window. Ask them to confirm bank details are linked. Give the specific next payout date. If genuinely overdue, escalate with a 48-hour resolution timeline. For "amount too low" queries, explain the net-profit calculation and offer a line-by-line breakdown — transparent, not defensive.',
  },
  ISBN_METADATA: {
    query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
    guidance: 'Treat as high priority. Acknowledge this is a serious data issue and own it. Confirm immediate escalation to the production team. Give a 48-hour resolution timeline.',
  },
  PRINTING_QUALITY: {
    query: 'I received my author copies and the print quality is terrible. Images are blurry and pages misaligned.',
    guidance: 'Apologise sincerely. Ask for photos of the defective copies. Confirm a free reprint once verified, with a 5–7 business day timeline.',
  },
  DISTRIBUTION_AVAILABILITY: {
    query: 'My book is published but showing as "Currently Unavailable" on Amazon.',
    guidance: 'Explain this is typically a stock sync issue. Confirm you are triggering a re-sync with the distribution team. Set expectation: live again within 24–48 hours.',
  },
  BOOK_STATUS_PRODUCTION: {
    query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
    guidance: 'Use the actual production status provided. Be honest about the reason for delay. Give a specific updated timeline. Do not blame the author — frame collaboratively.',
  },
  GENERAL_INQUIRY: {
    query: 'Can I update the description of my book on Amazon after it is already live?',
    guidance: 'Yes — via the dashboard or by emailing the team; changes reflect within 3–5 business days.',
  },
};
