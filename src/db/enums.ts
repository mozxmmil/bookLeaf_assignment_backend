/** Re-export Prisma enums (value + type) so non-DB modules (AI, validation) don't depend on the client path. */
import { Category, Priority, TicketStatus } from '../generated/prisma/enums.js';
export { Category, Priority, TicketStatus, Role, AiStatus } from '../generated/prisma/enums.js';

const values = <T extends Record<string, string>>(e: T) => Object.values(e) as [T[keyof T], ...T[keyof T][]];
export const CATEGORY_VALUES = values(Category);
export const PRIORITY_VALUES = values(Priority);
export const STATUS_VALUES = values(TicketStatus);
