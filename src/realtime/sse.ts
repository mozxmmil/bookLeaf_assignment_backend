import type { Request, Response } from 'express';
import type { Role } from '../middleware/auth.js';

/**
 * Minimal in-process Server-Sent Events hub.
 * One-way server → client is all the portal needs (new tickets, replies, status changes),
 * so SSE is simpler than WebSockets and works through most proxies.
 * Note: in-memory → single instance only. For horizontal scaling, back this with Redis pub/sub.
 */
interface Client { userId: string; role: Role; res: Response }
const clients = new Set<Client>();

export type RealtimeEvent = 'ticket.created' | 'ticket.updated' | 'message.created';

export function sseHandler(req: Request, res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);

  const client: Client = { userId: req.user!.id, role: req.user!.role, res };
  clients.add(client);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

  // Listen on the response: it reliably signals the client disconnecting (req 'close' semantics changed across Node versions).
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

/** Deliver to all admins plus the listed users (e.g. the ticket's author). */
export function publish(event: RealtimeEvent, payload: unknown, opts: { userIds?: string[]; admins?: boolean } = {}) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if ((opts.admins && c.role === 'ADMIN') || opts.userIds?.includes(c.userId)) c.res.write(frame);
  }
}

export const connectedClients = () => clients.size;
