/**
 * Offline quality check for the AI layer using BookLeaf's sample queries.
 *   npm run ai:eval
 * Reports classification accuracy and whether each draft mentions the key policy facts.
 * Requires GEMINI_API_KEY; without it, shows rules-fallback accuracy only.
 */
import { aiEnabled, classifyTicket, draftReply, usageStats } from '../src/ai/aiService.js';
import type { Category } from '../src/db/schema.js';

const CASES: { q: string; category: Category; mustMention: RegExp[] }[] = [
  { q: "I published my book 4 months ago and still haven't received any royalty. What's going on?", category: 'ROYALTY_PAYMENTS', mustMention: [/45 days|quarter/i, /bank/i] },
  { q: 'My royalty amount seems too low. I sold 200 copies but only received ₹3,000.', category: 'ROYALTY_PAYMENTS', mustMention: [/printing/i, /commission/i, /breakdown/i] },
  { q: "My book is showing a different ISBN on Amazon than what's on the physical copy.", category: 'ISBN_METADATA', mustMention: [/48 hours/i, /production team/i] },
  { q: 'I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.', category: 'PRINTING_QUALITY', mustMention: [/photo/i, /reprint/i, /5.{1,4}7/i] },
  { q: 'My book is published but it\'s showing as "Currently Unavailable" on Amazon.', category: 'DISTRIBUTION_AVAILABILITY', mustMention: [/sync/i, /24.{1,4}48/i] },
  { q: "It's been 3 weeks and my book is still in typesetting. When will it be done?", category: 'BOOK_STATUS_PRODUCTION', mustMention: [/typesetting/i] },
  { q: 'Can I update the description of my book on Amazon after it is already live?', category: 'GENERAL_INQUIRY', mustMention: [/3.{1,4}5/i, /dashboard|email/i] },
];

let correct = 0;
for (const c of CASES) {
  const cls = await classifyTicket({ subject: c.q.slice(0, 60), description: c.q });
  const ok = cls.category === c.category;
  if (ok) correct++;
  console.log(`\n${ok ? '✅' : '❌'} [${cls.source}] ${cls.category}/${cls.priority} — "${c.q.slice(0, 70)}…"`);
  if (!aiEnabled()) continue;
  try {
    const { draft } = await draftReply({
      category: c.category, authorFirstName: 'Priya', subject: c.q.slice(0, 60), description: c.q, recentMessages: [],
      facts: ["Today's date: 25 October 2026", 'Next scheduled payout date: 14 November 2026', 'Book: "The Silent River" — status: Typesetting'],
      adminName: 'Aisha',
    });
    const missing = c.mustMention.filter((re) => !re.test(draft));
    console.log(`   draft ${missing.length ? `⚠ missing ${missing.join(', ')}` : '✓ covers key facts'} (${draft.split(/\s+/).length} words)`);
    console.log(draft.split('\n').map((l) => `   │ ${l}`).join('\n'));
  } catch (e) { console.log(`   draft failed: ${(e as Error).message}`); }
}
console.log(`\nClassification accuracy: ${correct}/${CASES.length}`);
console.log(`Token usage: in=${usageStats.inputTokens} out=${usageStats.outputTokens} calls=${usageStats.calls}`);
process.exit(0);
