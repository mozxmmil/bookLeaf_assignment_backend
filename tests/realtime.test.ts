import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { prisma } from '../src/db/client.js';
import { flushAiJobs } from '../src/modules/tickets/tickets.service.js';
import { ADMIN, AUTHOR_A, app, disableAI, login, resetDb } from './helpers.js';

let server: Server; let base: string; let author: string; let admin: string;

beforeAll(async () => {
  disableAI();
  await resetDb();
  author = await login(AUTHOR_A.email, AUTHOR_A.password);
  admin = await login(ADMIN.email, ADMIN.password);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => { await flushAiJobs(); server.close(); await prisma.$disconnect(); });

/** Opens an SSE stream; resolves once connected. `next(name)` waits for the next matching event. */
async function openStream(token: string) {
  const ctrl = new AbortController();
  const events: { name: string; data: any }[] = [];
  const waiters: { name: string; resolve: (d: any) => void }[] = [];
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const res = await fetch(`${base}/stream?token=${token}`, { signal: ctrl.signal });
  (async () => {
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const name = /event: (.*)/.exec(frame)?.[1]; const raw = /data: (.*)/.exec(frame)?.[1];
          if (!name) continue;
          if (name === 'ready') { resolveReady(); continue; }
          const data = JSON.parse(raw!);
          const w = waiters.findIndex((x) => x.name === name);
          if (w >= 0) waiters.splice(w, 1)[0].resolve(data); else events.push({ name, data });
        }
      }
    } catch { /* aborted */ }
  })();
  await ready;
  return {
    next(name: string, timeoutMs = 4000) {
      const i = events.findIndex((e) => e.name === name);
      if (i >= 0) return Promise.resolve(events.splice(i, 1)[0].data);
      return new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), timeoutMs);
        waiters.push({ name, resolve: (d) => { clearTimeout(t); resolve(d); } });
      });
    },
    close: () => ctrl.abort(),
  };
}

describe('real-time updates (SSE)', () => {
  it('rejects unauthenticated stream', async () => {
    const res = await fetch(`${base}/stream`);
    expect(res.status).toBe(401);
  });

  it('admin receives ticket.created; author receives admin reply without polling', async () => {
    const adminStream = await openStream(admin);
    const authorStream = await openStream(author);
    const created = await fetch(`${base}/tickets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${author}` },
      body: JSON.stringify({ subject: 'Book unavailable on Amazon', description: 'My book shows Currently Unavailable on Amazon India since last week.' }),
    }).then((r) => r.json());
    expect((await adminStream.next('ticket.created')).ticketId).toBe(created.data.id);

    await fetch(`${base}/admin/tickets/${created.data.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ body: 'Hi Priya, we have triggered a re-sync; it will be live within 24–48 hours.' }),
    });
    expect(await authorStream.next('message.created')).toMatchObject({ ticketId: created.data.id, from: 'bookleaf' });
    adminStream.close(); authorStream.close();
  });
});
