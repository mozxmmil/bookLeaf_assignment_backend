import { Router } from 'express';
import { currentAuthorId } from '../../middleware/auth.js';
import { getValidated, idParam, validate } from '../../middleware/validate.js';
import { authorListQuery, createTicketSchema, messageSchema } from './tickets.schemas.js';
import * as svc from './tickets.service.js';

/** Author-facing ticket endpoints. Every query is scoped to the logged-in author. */
export const ticketsRouter = Router();

ticketsRouter.get('/', validate(authorListQuery, 'query'), async (req, res) => {
  const { status } = getValidated<{ status?: any[] }>(req, 'query');
  const items = await svc.listAuthorTickets(currentAuthorId(req), status);
  res.json({ data: items, meta: { total: items.length } });
});

ticketsRouter.post('/', validate(createTicketSchema), async (req, res) => {
  const ticket = await svc.createTicket(currentAuthorId(req), req.user!.id, req.body);
  res.status(201).location(`/api/v1/tickets/${ticket.id}`).json({ data: ticket });
});

ticketsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = getValidated<{ id: number }>(req, 'params');
  res.json({ data: await svc.getAuthorTicket(currentAuthorId(req), id) });
});

ticketsRouter.post('/:id/messages', validate(idParam, 'params'), validate(messageSchema), async (req, res) => {
  const { id } = getValidated<{ id: number }>(req, 'params');
  res.status(201).json({ data: await svc.authorReply(currentAuthorId(req), req.user!.id, id, req.body.body) });
});
