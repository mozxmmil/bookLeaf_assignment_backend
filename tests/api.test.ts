import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/client.js';
import { flushAiJobs } from '../src/modules/tickets/tickets.service.js';
import { ADMIN, AUTHOR_A, AUTHOR_B, api, disableAI, login, resetDb, useFakeAI } from './helpers.js';

let authorA: string, authorB: string, admin: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await resetDb();
  [authorA, authorB, admin] = await Promise.all([
    login(AUTHOR_A.email, AUTHOR_A.password), login(AUTHOR_B.email, AUTHOR_B.password), login(ADMIN.email, ADMIN.password),
  ]);
});
beforeEach(() => disableAI());
afterAll(async () => { await flushAiJobs(); await prisma.$disconnect(); });

describe('auth', () => {
  it('rejects wrong password with a generic message', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: AUTHOR_A.email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
  });
  it('validates login input', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('sets an httpOnly cookie and returns the user', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: AUTHOR_A.email.toUpperCase(), password: AUTHOR_A.password });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/bl_token=.*HttpOnly/);
    expect(res.body.data.user).toMatchObject({ role: 'AUTHOR', authorId: 'AUT001' });
  });
  it('protects routes without a token', async () => {
    const res = await api().get('/api/v1/books');
    expect(res.status).toBe(401);
  });
  it('rejects a tampered token', async () => {
    const res = await api().get('/api/v1/books').set(auth(authorA + 'x'));
    expect(res.status).toBe(401);
  });
  it('GET /me returns current user', async () => {
    const res = await api().get('/api/v1/auth/me').set(auth(admin));
    expect(res.body.data).toMatchObject({ role: 'ADMIN', email: ADMIN.email });
  });
});

describe('RBAC', () => {
  it('authors cannot reach admin routes', async () => {
    const res = await api().get('/api/v1/admin/tickets').set(auth(authorA));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
  it('admins cannot use author-only routes', async () => {
    const res = await api().get('/api/v1/books').set(auth(admin));
    expect(res.status).toBe(403);
  });
  it('unknown routes return a JSON 404', async () => {
    const res = await api().get('/api/v1/nope').set(auth(admin));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('books', () => {
  it('returns only the author\'s own books with derived royalty fields', async () => {
    const res = await api().get('/api/v1/books').set(auth(authorA));
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: any) => b.id).sort()).toEqual(['BK001', 'BK002']);
    const bk1 = res.body.data.find((b: any) => b.id === 'BK001');
    expect(bk1).toMatchObject({ royaltyEarned: 61210, royaltyPaid: 48000, royaltyPending: 13210, isPublished: true });
    expect(res.body.meta.totals.royaltyPending).toBe(13210 + 3360);
  });
  it('handles books in production (no ISBN, zero sales)', async () => {
    const res = await api().get('/api/v1/books').set(auth(authorB));
    const prod = res.body.data.find((b: any) => b.id === 'BK007');
    expect(prod).toMatchObject({ isbn: null, isPublished: false, copiesSold: 0, royaltyPending: 0 });
  });
  it("returns 404 for another author's book", async () => {
    const res = await api().get('/api/v1/books/BK007').set(auth(authorA));
    expect(res.status).toBe(404);
  });
});

describe('ticket lifecycle', () => {
  let ticketId: number;

  it('validates ticket input with field-level details', async () => {
    const res = await api().post('/api/v1/tickets').set(auth(authorA)).send({ subject: 'Hi', description: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: any) => d.field)).toEqual(expect.arrayContaining(['subject', 'description']));
  });

  it("rejects a bookId that belongs to someone else", async () => {
    const res = await api().post('/api/v1/tickets').set(auth(authorA))
      .send({ bookId: 'BK007', subject: 'Question about book', description: 'This is a sufficiently long description.' });
    expect(res.status).toBe(400);
  });

  it('creates a ticket even when AI is down, using rules fallback', async () => {
    const res = await api().post('/api/v1/tickets').set(auth(authorA)).send({
      bookId: 'BK001', subject: 'Royalty not received',
      description: "I haven't received any royalty for 6 months. Please check what is going on.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    ticketId = res.body.data.id;
    await flushAiJobs();
    const detail = await api().get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(detail.body.data).toMatchObject({ category: 'ROYALTY_PAYMENTS', priority: 'CRITICAL' });
    expect(detail.body.data.ai).toMatchObject({ status: 'FAILED', source: 'rules' });
  });

  it('uses the LLM classification when available', async () => {
    const fake = useFakeAI();
    fake.queue.push(JSON.stringify({ category: 'PRINTING_QUALITY', priority: 'HIGH', reason: 'Defective copies' }));
    const res = await api().post('/api/v1/tickets').set(auth(authorA)).send({
      bookId: 'BK002', subject: 'Blurry pages in author copies', description: 'The images in my author copies are blurry and pages misaligned.',
    });
    await flushAiJobs();
    const detail = await api().get(`/api/v1/admin/tickets/${res.body.data.id}`).set(auth(admin));
    expect(detail.body.data).toMatchObject({ category: 'PRINTING_QUALITY', priority: 'HIGH' });
    expect(detail.body.data.ai.source).toBe('llm');
    // Classification prompt must not carry the full knowledge base (cost control)
    expect(fake.calls[0].prompt).not.toContain('80/20');
    expect(fake.calls[0].maxOutputTokens).toBeLessThanOrEqual(150);
  });

  it('author sees own ticket but not internal fields; other author gets 404', async () => {
    const own = await api().get(`/api/v1/tickets/${ticketId}`).set(auth(authorA));
    expect(own.status).toBe(200);
    expect(own.body.data).not.toHaveProperty('priority');
    expect(own.body.data).not.toHaveProperty('notes');
    const other = await api().get(`/api/v1/tickets/${ticketId}`).set(auth(authorB));
    expect(other.status).toBe(404);
  });

  it('admin queue lists tickets sorted by priority and supports filters', async () => {
    const all = await api().get('/api/v1/admin/tickets').set(auth(admin));
    expect(all.status).toBe(200);
    expect(all.body.data[0].priority).toBe('CRITICAL');
    const filtered = await api().get('/api/v1/admin/tickets?priority=high&category=PRINTING_QUALITY').set(auth(admin));
    expect(filtered.body.data.every((t: any) => t.priority === 'HIGH')).toBe(true);
    const bad = await api().get('/api/v1/admin/tickets?status=WHATEVER').set(auth(admin));
    expect(bad.status).toBe(400);
  });

  it('admin can override category/priority; overrides survive re-classification', async () => {
    const res = await api().patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ priority: 'HIGH' });
    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe('HIGH');
    expect(res.body.data.ai.priorityOverridden).toBe(true);
    const re = await api().post(`/api/v1/admin/tickets/${ticketId}/reclassify`).set(auth(admin));
    expect(re.body.data.priority).toBe('HIGH');       // override kept
    expect(re.body.data.ai.priority).toBe('CRITICAL'); // AI opinion recorded separately
  });

  it('draft endpoint degrades gracefully when AI is unavailable', async () => {
    const res = await api().post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ draft: null, aiAvailable: false });
  });

  it('draft is generated with relevant KB + facts and cached', async () => {
    const fake = useFakeAI();
    fake.queue.push('Hi Priya, I completely understand how frustrating this is. Your next payout is due soon. Aisha, BookLeaf Author Support');
    const first = await api().post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin));
    expect(first.body.data).toMatchObject({ aiAvailable: true, cached: false });
    const prompt = fake.calls[0].prompt;
    expect(prompt).toContain('ROYALTY POLICY');
    expect(prompt).not.toContain('PRINTING & QUALITY'); // only the relevant section
    expect(prompt).toContain('pending: ₹13,210');
    expect(prompt).toContain('Next scheduled payout date');
    const second = await api().post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin));
    expect(second.body.data.cached).toBe(true);
    expect(fake.calls.length).toBe(1); // no second AI call
  });

  it('admin reply moves ticket to IN_PROGRESS, auto-assigns, and shows to author', async () => {
    const res = await api().post(`/api/v1/admin/tickets/${ticketId}/messages`).set(auth(admin))
      .send({ body: 'Hi Priya, we are looking into this and will update you within 48 hours.', isAiAssisted: true });
    expect(res.status).toBe(201);
    const a = await api().get(`/api/v1/tickets/${ticketId}`).set(auth(authorA));
    expect(a.body.data.status).toBe('IN_PROGRESS');
    expect(a.body.data.messages.at(-1)).toMatchObject({ from: 'bookleaf' });
    expect(a.body.data.messages.at(-1)).not.toHaveProperty('isAiAssisted');
    const d = await api().get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(d.body.data.assignee.name).toMatch(/Aisha/);
    expect(d.body.data.ai.hasCachedDraft).toBe(false); // draft invalidated after reply
  });

  it('internal notes are visible to admins only', async () => {
    await api().post(`/api/v1/admin/tickets/${ticketId}/notes`).set(auth(admin)).send({ body: 'Checked bank details — missing IFSC' });
    const d = await api().get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(d.body.data.notes).toHaveLength(1);
    const a = await api().get(`/api/v1/tickets/${ticketId}`).set(auth(authorA));
    expect(JSON.stringify(a.body)).not.toContain('IFSC');
  });

  it('assign to self works', async () => {
    const support = await login('support@bookleaf.com', ADMIN.password);
    const res = await api().post(`/api/v1/admin/tickets/${ticketId}/assign`).set(auth(support));
    expect(res.body.data.assignee.name).toMatch(/Rohan/);
    const mine = await api().get('/api/v1/admin/tickets?assignee=me').set(auth(support));
    expect(mine.body.data.map((t: any) => t.id)).toContain(ticketId);
  });

  it('enforces status transitions', async () => {
    await api().patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ status: 'CLOSED' }).expect(200);
    const bad = await api().patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ status: 'RESOLVED' });
    expect(bad.status).toBe(409);
    const reply = await api().post(`/api/v1/tickets/${ticketId}/messages`).set(auth(authorA)).send({ body: 'Any update?' });
    expect(reply.status).toBe(409);
    await api().patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ status: 'OPEN' }).expect(200);
  });

  it('author follow-up reopens a resolved ticket', async () => {
    await api().patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ status: 'RESOLVED' }).expect(200);
    await api().post(`/api/v1/tickets/${ticketId}/messages`).set(auth(authorA)).send({ body: 'Still not received, sorry!' }).expect(201);
    const a = await api().get(`/api/v1/tickets/${ticketId}`).set(auth(authorA));
    expect(a.body.data.status).toBe('OPEN');
  });

  it('stats endpoint aggregates counts', async () => {
    const res = await api().get('/api/v1/admin/stats').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.byStatus.OPEN).toBeGreaterThan(0);
  });

  it('rejects invalid ids and malformed JSON with 400', async () => {
    expect((await api().get('/api/v1/admin/tickets/abc').set(auth(admin))).status).toBe(400);
    const res = await api().post('/api/v1/tickets').set(auth(authorA)).set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
