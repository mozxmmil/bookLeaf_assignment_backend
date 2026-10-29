import { prisma } from '../../db/client.js';
import type { Prisma, Ticket } from '../../generated/prisma/client.js';
import type { Category, Priority, TicketStatus } from '../../db/enums.js';
import { AIUnavailableError, aiEnabled, classifyTicket, draftReply } from '../../ai/aiService.js';
import { CATEGORY_LABELS } from '../../ai/knowledgeBase.js';
import { publish } from '../../realtime/sse.js';
import { AppError } from '../../utils/AppError.js';
import { formatDate, formatINR, MIN_PAYOUT, nextPayoutDate } from '../../utils/royalty.js';
import { toBookDTO, type BookDTO } from '../books/books.service.js';
import type { AdminListQuery } from './tickets.schemas.js';

// ---------------------------------------------------------------------------
// Background AI jobs
// ---------------------------------------------------------------------------

/** In-flight classification jobs. Tests await these; in production a queue (e.g. BullMQ) would own them. */
const pendingJobs = new Set<Promise<void>>();
export const flushAiJobs = () => Promise.all([...pendingJobs]);

function enqueue(job: () => Promise<void>) {
  const p: Promise<void> = job()
    .catch((e) => console.error('[ai-job] unexpected error', e))
    .finally(() => pendingJobs.delete(p));
  pendingJobs.add(p);
}

/** Classify + prioritise a ticket. Never throws; never overwrites an admin override. */
export async function runClassification(ticketId: number) {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { book: { select: { title: true, status: true } } } });
  if (!t) return;

  const result = await classifyTicket({
    subject: t.subject, description: t.description, bookTitle: t.book?.title, bookStatus: t.book?.status,
  });

  // Always record the AI's opinion; only apply it where an admin hasn't overridden.
  // Conditional updateMany calls make this safe against a concurrent admin override.
  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticketId },
      data: {
        aiCategory: result.category, aiPriority: result.priority, aiReason: result.reason, aiSource: result.source,
        aiStatus: result.source === 'llm' ? 'DONE' : 'FAILED',
      },
    }),
    prisma.ticket.updateMany({ where: { id: ticketId, categoryOverridden: false }, data: { category: result.category } }),
    prisma.ticket.updateMany({ where: { id: ticketId, priorityOverridden: false }, data: { priority: result.priority } }),
  ]);

  publish('ticket.updated', { ticketId, reason: 'classified' }, { admins: true });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const messageInclude = { sender: { select: { name: true } } } satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

const toMessageDTO = (m: MessageRow, forAuthor: boolean) => ({
  id: m.id,
  from: m.senderRole === 'AUTHOR' ? ('author' as const) : ('bookleaf' as const),
  senderName: m.senderRole === 'ADMIN' && forAuthor ? `${m.sender.name.split(' ')[0]} · BookLeaf Support` : m.sender.name,
  body: m.body,
  ...(forAuthor ? {} : { isAiAssisted: m.isAiAssisted }),
  createdAt: m.createdAt,
});

const loadMessages = (ticketId: number) =>
  prisma.message.findMany({ where: { ticketId }, include: messageInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

/** Allowed status transitions. CLOSED is terminal except an explicit reopen to OPEN. */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
};

async function getTicketOr404(id: number, authorId?: string): Promise<Ticket> {
  const t = await prisma.ticket.findFirst({ where: { id, ...(authorId ? { authorId } : {}) } });
  // Another author's ticket → 404, so ticket ids can't be probed.
  if (!t) throw AppError.notFound('Ticket');
  return t;
}

async function authorUserId(authorId: string) {
  const a = await prisma.author.findUnique({ where: { id: authorId }, select: { userId: true } });
  return a?.userId;
}

const ACTIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS'];

// ---------------------------------------------------------------------------
// Author operations
// ---------------------------------------------------------------------------

export async function createTicket(
  authorId: string, userId: string,
  input: { bookId: string | null; subject: string; description: string; attachmentName?: string | null },
) {
  if (input.bookId) {
    const book = await prisma.book.findFirst({ where: { id: input.bookId, authorId }, select: { id: true } });
    if (!book) throw new AppError('VALIDATION_ERROR', 'Selected book was not found in your account', [{ field: 'bookId', message: 'Unknown book' }]);
  }

  // 1) Persist first — ticket creation must never depend on the AI provider.
  const ticket = await prisma.ticket.create({
    data: {
      authorId, bookId: input.bookId, subject: input.subject, description: input.description,
      attachmentName: input.attachmentName ?? null,
    },
  });

  publish('ticket.created', { ticketId: ticket.id }, { admins: true, userIds: [userId] });

  // 2) Classify asynchronously; the author gets an instant response.
  enqueue(() => runClassification(ticket.id));

  return { id: ticket.id, status: ticket.status, createdAt: ticket.createdAt };
}

export async function listAuthorTickets(authorId: string, status?: TicketStatus[]) {
  const rows = await prisma.ticket.findMany({
    where: { authorId, ...(status?.length ? { status: { in: status } } : {}) },
    orderBy: { updatedAt: 'desc' },
    include: {
      book: { select: { id: true, title: true } },
      messages: { select: { senderRole: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    book: r.book, replyCount: r.messages.filter((m) => m.senderRole === 'ADMIN').length,
    lastMessageAt: r.messages[0]?.createdAt ?? null,
  }));
}

export async function getAuthorTicket(authorId: string, id: number) {
  const t = await prisma.ticket.findFirst({ where: { id, authorId }, include: { book: { select: { id: true, title: true } } } });
  if (!t) throw AppError.notFound('Ticket');
  const msgs = await loadMessages(id);
  // Deliberately excludes internal notes, AI fields, assignee and priority.
  return {
    id: t.id, subject: t.subject, description: t.description, status: t.status, attachmentName: t.attachmentName,
    book: t.book, createdAt: t.createdAt, updatedAt: t.updatedAt,
    messages: msgs.map((m) => toMessageDTO(m, true)),
  };
}

/** Author follow-up on their own ticket. Re-opens a resolved ticket; closed tickets need a new ticket. */
export async function authorReply(authorId: string, userId: string, id: number, body: string) {
  const t = await getTicketOr404(id, authorId);
  if (t.status === 'CLOSED') throw new AppError('CONFLICT', 'This ticket is closed. Please raise a new ticket.');
  const [msg] = await prisma.$transaction([
    prisma.message.create({ data: { ticketId: id, senderId: userId, senderRole: 'AUTHOR', body } }),
    prisma.ticket.update({
      where: { id },
      data: { status: t.status === 'RESOLVED' ? 'OPEN' : t.status, aiDraft: null /* new context → stale draft */ },
    }),
  ]);
  publish('message.created', { ticketId: id, messageId: msg.id, from: 'author' }, { admins: true, userIds: [userId] });
  return { id: msg.id, createdAt: msg.createdAt };
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

export async function listAdminTickets(adminId: string, q: AdminListQuery) {
  const where: Prisma.TicketWhereInput = {
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.category?.length ? { category: { in: q.category } } : {}),
    ...(q.priority?.length ? { priority: { in: q.priority } } : {}),
    ...(q.assignee === 'me' ? { assigneeId: adminId } : q.assignee === 'unassigned' ? { assigneeId: null } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: endOfDay(q.to) } : {}) } } : {}),
    ...(q.q ? {
      OR: [
        { subject: { contains: q.q, mode: 'insensitive' } },
        { author: { user: { name: { contains: q.q, mode: 'insensitive' } } } },
        { author: { user: { email: { contains: q.q, mode: 'insensitive' } } } },
      ],
    } : {}),
  };

  // Postgres enums sort in declaration order, so status ASC = Open → Closed and priority ASC = Critical → Low.
  // Default: unresolved first, most urgent next, then oldest — neglected urgent tickets float to the top.
  const orderBy: Prisma.TicketOrderByWithRelationInput[] =
    q.sort === 'newest' ? [{ createdAt: 'desc' }]
    : q.sort === 'oldest' ? [{ createdAt: 'asc' }]
    : [{ status: 'asc' }, { priority: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }];

  const [rows, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit,
      include: {
        author: { select: { id: true, user: { select: { name: true, email: true } } } },
        book: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true } },
        messages: { select: { senderRole: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id, subject: r.subject, status: r.status, category: r.category, priority: r.priority, aiStatus: r.aiStatus,
      author: { id: r.author.id, name: r.author.user.name, email: r.author.user.email },
      book: r.book, assignee: r.assignee,
      awaitingReply: r.messages[0]?.senderRole !== 'ADMIN' && ACTIVE.includes(r.status),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
    meta: { page: q.page, limit: q.limit, total },
  };
}

export async function getAdminTicket(id: number) {
  const t = await prisma.ticket.findUnique({
    where: { id },
    include: {
      author: { include: { user: { select: { name: true, email: true } } } },
      book: true,
      assignee: { select: { id: true, name: true } },
      notes: { include: { admin: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!t) throw AppError.notFound('Ticket');
  const [msgs, otherOpen] = await Promise.all([
    loadMessages(id),
    prisma.ticket.findMany({
      where: { authorId: t.authorId, status: { in: ACTIVE }, id: { not: id } },
      select: { id: true, subject: true, status: true }, take: 5,
    }),
  ]);

  return {
    id: t.id, subject: t.subject, description: t.description, status: t.status, attachmentName: t.attachmentName,
    category: t.category, priority: t.priority,
    ai: {
      status: t.aiStatus, source: t.aiSource, category: t.aiCategory, priority: t.aiPriority, reason: t.aiReason,
      categoryOverridden: t.categoryOverridden, priorityOverridden: t.priorityOverridden,
      enabled: aiEnabled(), hasCachedDraft: Boolean(t.aiDraft),
    },
    author: {
      id: t.author.id, name: t.author.user.name, email: t.author.user.email, city: t.author.city,
      country: t.author.country, joinedDate: t.author.joinedDate,
    },
    book: t.book ? toBookDTO(t.book) : null,
    assignee: t.assignee,
    messages: msgs.map((m) => toMessageDTO(m, false)),
    notes: t.notes.map((n) => ({ id: n.id, body: n.body, adminName: n.admin.name, createdAt: n.createdAt })),
    otherOpenTickets: otherOpen,
    createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt,
  };
}

export async function updateTicket(id: number, patch: { status?: TicketStatus; category?: Category; priority?: Priority }) {
  const t = await getTicketOr404(id);
  const data: Prisma.TicketUpdateInput = {};

  if (patch.status && patch.status !== t.status) {
    if (!TRANSITIONS[t.status].includes(patch.status)) {
      throw new AppError('CONFLICT', `Cannot change status from ${t.status} to ${patch.status}`);
    }
    data.status = patch.status;
    data.resolvedAt = patch.status === 'RESOLVED' || patch.status === 'CLOSED' ? new Date() : null;
  }
  if (patch.category && patch.category !== t.category) {
    data.category = patch.category; data.categoryOverridden = true;
    data.aiDraft = null; // draft used the old category's policy section
  }
  if (patch.priority && patch.priority !== t.priority) { data.priority = patch.priority; data.priorityOverridden = true; }

  if (Object.keys(data).length) await prisma.ticket.update({ where: { id }, data });
  const userId = await authorUserId(t.authorId);
  // Authors only hear about status changes; admins get everything.
  publish('ticket.updated', { ticketId: id, status: data.status ?? t.status }, { admins: true, userIds: data.status && userId ? [userId] : [] });
  return getAdminTicket(id);
}

export async function assignToSelf(id: number, adminId: string) {
  await getTicketOr404(id);
  await prisma.ticket.update({ where: { id }, data: { assigneeId: adminId } });
  publish('ticket.updated', { ticketId: id, reason: 'assigned' }, { admins: true });
  return getAdminTicket(id);
}

export async function retryClassification(id: number) {
  await getTicketOr404(id);
  await runClassification(id);
  return getAdminTicket(id);
}

/**
 * Returns the cached draft if present (zero AI cost), otherwise generates one.
 * On AI failure returns { draft: null, aiAvailable: false } — the UI switches to manual writing.
 */
export async function getDraft(id: number, admin: { name: string }, refresh: boolean) {
  const t = await prisma.ticket.findUnique({ where: { id }, include: { book: true, author: { include: { user: { select: { name: true } } } } } });
  if (!t) throw AppError.notFound('Ticket');
  if (t.aiDraft && !refresh) return { draft: t.aiDraft, cached: true, aiAvailable: true };

  const msgs = await loadMessages(id);
  try {
    const { draft } = await draftReply({
      category: t.category ?? 'GENERAL_INQUIRY',
      authorFirstName: t.author.user.name.split(' ')[0] ?? 'there',
      subject: t.subject,
      description: t.description,
      // Only the last 2 messages — bounded cost; older history rarely changes the reply.
      recentMessages: msgs.slice(-2).map((m) => ({ from: m.senderRole === 'AUTHOR' ? 'author' : 'bookleaf', body: m.body })),
      facts: buildFacts(t, t.book ? toBookDTO(t.book) : null),
      adminName: admin.name.split(' ')[0],
    });
    await prisma.ticket.update({ where: { id }, data: { aiDraft: draft } });
    return { draft, cached: false, aiAvailable: true };
  } catch (e) {
    if (e instanceof AIUnavailableError) return { draft: null, cached: false, aiAvailable: false, reason: e.message.slice(0, 160) };
    throw e;
  }
}

/** Verified facts from our DB, computed in code so the model never has to guess numbers or dates. */
export function buildFacts(t: Pick<Ticket, 'createdAt' | 'category'>, book: BookDTO | null, today = new Date()): string[] {
  const facts = [
    `Today's date: ${formatDate(today)}`,
    `Ticket opened: ${formatDate(t.createdAt)}`,
    `Ticket category: ${CATEGORY_LABELS[t.category ?? 'GENERAL_INQUIRY']}`,
  ];
  if (!book) return [...facts, 'The query is about the author account in general, not a specific book.'];

  facts.push(`Book: "${book.title}" — status: ${book.status}`);
  facts.push(book.isbn ? `ISBN on record: ${book.isbn}` : 'No ISBN assigned yet (assigned during production, before printing).');
  if (book.publicationDate) facts.push(`Publication date: ${formatDate(new Date(book.publicationDate))}`);
  if (!book.isPublished) {
    facts.push('The book is still in production, so it has no sales or royalties yet.');
    return facts;
  }
  facts.push(
    `MRP: ${formatINR(book.mrp)}; total copies sold: ${book.copiesSold}`,
    `Royalty earned to date: ${formatINR(book.royaltyEarned)}; paid: ${formatINR(book.royaltyPaid)}; pending: ${formatINR(book.royaltyPending)}`,
    `Next scheduled payout date: ${formatDate(nextPayoutDate(today))}`,
  );
  if (book.royaltyPerCopy !== null) facts.push(`Author royalty per copy: ${formatINR(book.royaltyPerCopy)}`);
  if (book.lastPayoutDate) facts.push(`Last royalty payout: ${formatDate(new Date(book.lastPayoutDate))}`);
  else if (book.royaltyPaid === 0) facts.push('No royalty payout has been made for this book yet.');
  if (book.availableOn.length) facts.push(`Available on: ${book.availableOn.join(', ')}`);
  if (book.printPartner) facts.push(`Print partner: ${book.printPartner}`);
  if (book.belowPayoutThreshold) facts.push(`Pending royalty is below the ${formatINR(MIN_PAYOUT)} payout threshold and will roll over to the next quarter.`);
  if (book.royaltyEarned === 0 && book.copiesSold === 0) facts.push('No sales recorded yet for this book.');
  if (book.royaltyEarned === 0 && book.copiesSold > 0) facts.push('Sales are recorded but royalty for the current quarter has not been calculated yet.');
  return facts;
}

export async function adminReply(id: number, admin: { id: string }, body: string, isAiAssisted: boolean) {
  const t = await getTicketOr404(id);
  if (t.status === 'CLOSED') throw new AppError('CONFLICT', 'Reopen the ticket before replying');
  const [msg] = await prisma.$transaction([
    prisma.message.create({ data: { ticketId: id, senderId: admin.id, senderRole: 'ADMIN', body, isAiAssisted } }),
    prisma.ticket.update({
      where: { id },
      data: {
        status: t.status === 'OPEN' ? 'IN_PROGRESS' : t.status, // first reply moves the ticket forward
        assigneeId: t.assigneeId ?? admin.id,                   // replying implies ownership
        aiDraft: null,
      },
    }),
  ]);
  const userId = await authorUserId(t.authorId);
  publish('message.created', { ticketId: id, messageId: msg.id, from: 'bookleaf' }, { admins: true, userIds: userId ? [userId] : [] });
  return { id: msg.id, createdAt: msg.createdAt };
}

export async function addNote(id: number, adminId: string, body: string) {
  await getTicketOr404(id);
  const note = await prisma.internalNote.create({ data: { ticketId: id, adminId, body } });
  publish('ticket.updated', { ticketId: id, reason: 'note' }, { admins: true }); // admins only — never the author
  return note;
}

export async function getStats(adminId: string) {
  const groups = await prisma.ticket.groupBy({ by: ['status', 'priority'], _count: { _all: true } });
  const byStatus: Record<TicketStatus, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 };
  const openByPriority: Record<Priority | 'UNCLASSIFIED', number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNCLASSIFIED: 0 };
  for (const g of groups) {
    byStatus[g.status] += g._count._all;
    if (ACTIVE.includes(g.status)) openByPriority[g.priority ?? 'UNCLASSIFIED'] += g._count._all;
  }
  const [assignedToMe, olderThan48h, classified, catOverrides, prioOverrides] = await prisma.$transaction([
    prisma.ticket.count({ where: { assigneeId: adminId, status: { in: ACTIVE } } }),
    prisma.ticket.count({ where: { status: { in: ACTIVE }, createdAt: { lte: new Date(Date.now() - 48 * 3600_000) } } }),
    prisma.ticket.count({ where: { aiSource: 'llm' } }),
    prisma.ticket.count({ where: { aiSource: 'llm', categoryOverridden: true } }),
    prisma.ticket.count({ where: { aiSource: 'llm', priorityOverridden: true } }),
  ]);
  return { byStatus, openByPriority, assignedToMe, olderThan48h, ai: { enabled: aiEnabled(), classified, catOverrides, prioOverrides } };
}
