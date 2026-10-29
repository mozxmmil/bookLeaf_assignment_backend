import { prisma } from '../../db/client.js';
import type { Book } from '../../generated/prisma/client.js';
import { AppError } from '../../utils/AppError.js';
import { royaltySummary, toNumber } from '../../utils/royalty.js';

export const PUBLISHED_STATUS = /published|live/i;

/** API shape for a book: numbers as numbers, derived royalty fields, production flag. */
export function toBookDTO(b: Book) {
  return {
    id: b.id,
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    publicationDate: b.publicationDate ? b.publicationDate.toISOString().slice(0, 10) : null,
    status: b.status,
    isPublished: PUBLISHED_STATUS.test(b.status),
    mrp: toNumber(b.mrp.toString()),
    copiesSold: b.copiesSold,
    ...royaltySummary(b.royaltyEarned.toString(), b.royaltyPaid.toString()),
    royaltyPerCopy: b.royaltyPerCopy === null ? null : toNumber(b.royaltyPerCopy.toString()),
    lastPayoutDate: b.lastPayoutDate ? b.lastPayoutDate.toISOString().slice(0, 10) : null,
    printPartner: b.printPartner,
    availableOn: b.availableOn,
  };
}
export type BookDTO = ReturnType<typeof toBookDTO>;

export async function listAuthorBooks(authorId: string) {
  const rows = await prisma.book.findMany({
    where: { authorId },
    orderBy: [{ publicationDate: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
  });
  const items = rows.map(toBookDTO);
  const totals = items.reduce(
    (acc, b) => ({
      copiesSold: acc.copiesSold + b.copiesSold,
      royaltyEarned: acc.royaltyEarned + b.royaltyEarned,
      royaltyPaid: acc.royaltyPaid + b.royaltyPaid,
      royaltyPending: acc.royaltyPending + b.royaltyPending,
    }),
    { copiesSold: 0, royaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0 },
  );
  return { items, totals };
}

export async function getAuthorBook(authorId: string, bookId: string) {
  const row = await prisma.book.findFirst({ where: { id: bookId, authorId } });
  // 404 (not 403) so authors can't probe which book ids exist.
  if (!row) throw AppError.notFound('Book');
  return toBookDTO(row);
}
