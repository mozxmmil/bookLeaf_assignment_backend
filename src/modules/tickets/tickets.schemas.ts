import { z } from 'zod';
import { CATEGORY_VALUES, PRIORITY_VALUES, STATUS_VALUES } from '../../db/enums.js';

const trimmed = (min: number, max: number, field: string) =>
  z.string({ error: `${field} is required` }).trim()
    .min(min, `${field} must be at least ${min} characters`)
    .max(max, `${field} must be at most ${max} characters`);

export const createTicketSchema = z.object({
  bookId: z.string().trim().min(1).nullish().transform((v) => (v && v !== 'general' ? v : null)),
  subject: trimmed(5, 150, 'Subject'),
  description: trimmed(20, 5000, 'Description'),
  attachmentName: z.string().trim().max(255).nullish(),
});

export const messageSchema = z.object({
  body: trimmed(2, 5000, 'Message'),
  isAiAssisted: z.boolean().optional().default(false),
});

export const noteSchema = z.object({ body: trimmed(1, 2000, 'Note') });

export const updateTicketSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one of status, category, priority' });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().optional().transform((s, ctx) => {
    if (!s) return undefined;
    const parts = s.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
    for (const p of parts) {
      if (!values.includes(p)) {
        ctx.addIssue({ code: 'custom', message: `Invalid value "${p}". Allowed: ${values.join(', ')}` });
        return z.NEVER;
      }
    }
    return parts as T[number][];
  });

export const adminListQuery = z.object({
  status: csv(STATUS_VALUES),
  category: csv(CATEGORY_VALUES),
  priority: csv(PRIORITY_VALUES),
  assignee: z.enum(['me', 'unassigned']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['priority', 'oldest', 'newest']).default('priority'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminListQuery = z.infer<typeof adminListQuery>;

export const authorListQuery = z.object({ status: csv(STATUS_VALUES) });
export const draftQuery = z.object({ refresh: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });
