/**
 * Seeds the database from data/bookleaf_sample_data.json.
 * The loader is tolerant of key naming (snake_case / camelCase, nested or flat books)
 * so it keeps working if the official dataset uses a slightly different shape.
 *
 * Usage: npm run db:seed            (wipes and reseeds)
 */
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from './client.js';
import type { Category, Priority } from './enums.js';

export const DEMO_AUTHOR_PASSWORD = 'author123';
export const DEMO_ADMIN_PASSWORD = 'admin123';

type Raw = Record<string, any>;
const pick = (o: Raw, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};
const num = (v: unknown) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[₹,$\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isoDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export function normalizeDataset(raw: Raw) {
  const rawAuthors: Raw[] = raw.authors ?? raw.Authors ?? (Array.isArray(raw) ? raw : []);
  const flatBooks: Raw[] = raw.books ?? raw.Books ?? [];

  const outAuthors = rawAuthors.map((a, i) => {
    const id = String(pick(a, 'author_id', 'authorId', 'id') ?? `AUT${String(i + 1).padStart(3, '0')}`);
    return {
      id,
      name: String(pick(a, 'name', 'author_name', 'full_name', 'authorName') ?? `Author ${i + 1}`),
      email: String(pick(a, 'email', 'author_email') ?? `author${i + 1}@bookleaf.test`).toLowerCase(),
      phone: pick(a, 'phone', 'mobile', 'phone_number') ?? null,
      city: pick(a, 'city', 'location') ?? null,
      country: pick(a, 'country') ?? null,
      joinedDate: toDate(isoDate(pick(a, 'joined_date', 'joinedDate', 'join_date', 'created_at'))),
      nestedBooks: (pick(a, 'books', 'Books') ?? []) as Raw[],
    };
  });

  const allRawBooks = [
    ...outAuthors.flatMap((a) => a.nestedBooks.map((b) => ({ ...b, __authorId: a.id }))),
    ...flatBooks.map((b) => ({ ...b, __authorId: String(pick(b, 'author_id', 'authorId') ?? '') })),
  ];

  const outBooks = allRawBooks.map((b, i) => {
    const earned = num(pick(b, 'total_royalty_earned', 'royalty_earned', 'royaltyEarned', 'totalRoyaltyEarned'));
    const paidRaw = pick(b, 'royalty_paid', 'royaltyPaid', 'total_royalty_paid');
    const pendingRaw = pick(b, 'royalty_pending', 'royaltyPending');
    // If only pending is provided, derive paid from it.
    const paid = paidRaw !== undefined ? num(paidRaw) : Math.max(0, earned - num(pendingRaw));
    return {
      id: String(pick(b, 'book_id', 'bookId', 'id') ?? `BK${String(i + 1).padStart(3, '0')}`),
      authorId: b.__authorId,
      title: String(pick(b, 'title', 'book_title') ?? 'Untitled'),
      isbn: pick(b, 'isbn', 'ISBN') ?? null,
      genre: pick(b, 'genre', 'category') ?? null,
      publicationDate: toDate(isoDate(pick(b, 'publication_date', 'publicationDate', 'published_date'))),
      status: String(pick(b, 'status', 'publication_status', 'book_status') ?? 'Unknown'),
      mrp: String(num(pick(b, 'mrp', 'MRP', 'price'))),
      copiesSold: Math.round(num(pick(b, 'total_copies_sold', 'copies_sold', 'copiesSold', 'totalCopiesSold'))),
      royaltyEarned: String(earned),
      royaltyPaid: String(paid),
    };
  });

  return { authors: outAuthors.map(({ nestedBooks, ...a }) => a), books: outBooks };
}

export async function seed(opts: { withDemoTickets?: boolean } = {}) {
  const file = path.resolve(process.cwd(), 'data/bookleaf_sample_data.json');
  const data = normalizeDataset(JSON.parse(fs.readFileSync(file, 'utf8')));

  await prisma.$executeRawUnsafe(
    'TRUNCATE "InternalNote", "Message", "Ticket", "Book", "Author", "User" RESTART IDENTITY CASCADE',
  );

  const authorHash = await bcrypt.hash(DEMO_AUTHOR_PASSWORD, 10);
  const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 10);

  await prisma.user.createMany({
    data: [
      { id: 'ADM001', email: 'admin@bookleaf.com', name: 'Aisha (Support Lead)', role: 'ADMIN', passwordHash: adminHash },
      { id: 'ADM002', email: 'support@bookleaf.com', name: 'Rohan (Support)', role: 'ADMIN', passwordHash: adminHash },
    ],
  });

  for (const a of data.authors) {
    await prisma.user.create({
      data: {
        id: `USR_${a.id}`, email: a.email, name: a.name, role: 'AUTHOR', passwordHash: authorHash,
        author: { create: { id: a.id, phone: a.phone, city: a.city, country: a.country, joinedDate: a.joinedDate } },
      },
    });
  }
  if (data.books.length) await prisma.book.createMany({ data: data.books });

  if (opts.withDemoTickets) await seedDemoTickets(data.authors.map((a) => a.id), data.books);

  return { authors: data.authors.length, books: data.books.length };
}

/** A few pre-classified tickets so the admin queue isn't empty on first demo. */
async function seedDemoTickets(authorIds: string[], bookRows: { id: string; authorId: string }[]) {
  const bookOf = (aid: string) => bookRows.find((b) => b.authorId === aid)?.id ?? null;
  const demo = [
    { a: 0, subject: 'Royalty not received for two quarters',
      description: 'I have not received any royalty payment for the last 6 months even though my dashboard shows pending royalty. Please check urgently.',
      category: 'ROYALTY_PAYMENTS', priority: 'CRITICAL', hoursAgo: 70 },
    { a: 2, subject: 'Different ISBN on Amazon',
      description: 'My book shows a different ISBN on Amazon than the one printed on the physical copy. Readers are confused.',
      category: 'ISBN_METADATA', priority: 'HIGH', hoursAgo: 30 },
    { a: 6, subject: 'Can I update my author bio?',
      description: 'I would like to update my author bio on the book listing pages. What is the process?',
      category: 'GENERAL_INQUIRY', priority: 'LOW', hoursAgo: 5, general: true },
  ] as const;
  for (const d of demo) {
    const authorId = authorIds[d.a];
    if (!authorId) continue;
    const createdAt = new Date(Date.now() - d.hoursAgo * 3600_000);
    await prisma.ticket.create({
      data: {
        authorId, bookId: 'general' in d ? null : bookOf(authorId), subject: d.subject, description: d.description,
        category: d.category as Category, priority: d.priority as Priority, aiCategory: d.category as Category, aiPriority: d.priority as Priority,
        aiStatus: 'DONE', aiSource: 'llm', aiReason: 'Seeded demo ticket', createdAt, updatedAt: createdAt,
      },
    });
  }
}

// Run directly: `tsx src/db/seed.ts`
if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  seed({ withDemoTickets: !process.argv.includes('--no-demo') })
    .then((r) => console.log(`✅ Seeded ${r.authors} authors, ${r.books} books (+2 admins)`))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
