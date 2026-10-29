import { Router } from 'express';
import { getValidated, idParam, validate } from '../../middleware/validate.js';
import { usageStats } from '../../ai/aiService.js';
import { adminListQuery, draftQuery, messageSchema, noteSchema, updateTicketSchema, type AdminListQuery } from '../tickets/tickets.schemas.js';
import * as svc from '../tickets/tickets.service.js';

/** Admin-only endpoints (mounted behind requireRole('ADMIN')). */
export const adminRouter = Router();
const ticketId = (req: Parameters<Parameters<typeof adminRouter.get>[1]>[0]) => getValidated<{ id: number }>(req, 'params').id;

adminRouter.get('/stats', async (req, res) => {
  res.json({ data: await svc.getStats(req.user!.id) });
});

adminRouter.get('/ai/usage', (_req, res) => {
  res.json({ data: usageStats });
});

adminRouter.get('/tickets', validate(adminListQuery, 'query'), async (req, res) => {
  const { items, meta } = await svc.listAdminTickets(req.user!.id, getValidated<AdminListQuery>(req, 'query'));
  res.json({ data: items, meta });
});

adminRouter.get('/tickets/:id', validate(idParam, 'params'), async (req, res) => {
  res.json({ data: await svc.getAdminTicket(ticketId(req)) });
});

adminRouter.patch('/tickets/:id', validate(idParam, 'params'), validate(updateTicketSchema), async (req, res) => {
  res.json({ data: await svc.updateTicket(ticketId(req), req.body) });
});

adminRouter.post('/tickets/:id/assign', validate(idParam, 'params'), async (req, res) => {
  res.json({ data: await svc.assignToSelf(ticketId(req), req.user!.id) });
});

adminRouter.post('/tickets/:id/reclassify', validate(idParam, 'params'), async (req, res) => {
  res.json({ data: await svc.retryClassification(ticketId(req)) });
});

adminRouter.post('/tickets/:id/draft', validate(idParam, 'params'), validate(draftQuery, 'query'), async (req, res) => {
  const { refresh } = getValidated<{ refresh: boolean }>(req, 'query');
  res.json({ data: await svc.getDraft(ticketId(req), req.user!, refresh) });
});

adminRouter.post('/tickets/:id/messages', validate(idParam, 'params'), validate(messageSchema), async (req, res) => {
  res.status(201).json({ data: await svc.adminReply(ticketId(req), req.user!, req.body.body, req.body.isAiAssisted) });
});

adminRouter.post('/tickets/:id/notes', validate(idParam, 'params'), validate(noteSchema), async (req, res) => {
  res.status(201).json({ data: await svc.addNote(ticketId(req), req.user!.id, req.body.body) });
});
