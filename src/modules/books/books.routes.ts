import { Router } from 'express';
import { currentAuthorId } from '../../middleware/auth.js';
import { getAuthorBook, listAuthorBooks } from './books.service.js';

export const booksRouter = Router();

booksRouter.get('/', async (req, res) => {
  const { items, totals } = await listAuthorBooks(currentAuthorId(req));
  res.json({ data: items, meta: { total: items.length, totals } });
});

booksRouter.get('/:id', async (req, res) => {
  res.json({ data: await getAuthorBook(currentAuthorId(req), String(req.params.id)) });
});
