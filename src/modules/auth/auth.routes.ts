import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { authenticate, signToken, TOKEN_COOKIE, type AuthUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { isProd } from '../../config/env.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const authRouter = Router();

authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const user = await prisma.user.findUnique({ where: { email }, include: { author: { select: { id: true } } } });

  // Same message for unknown email and wrong password — don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError('UNAUTHORIZED', 'Invalid email or password');
  }

  const authUser: AuthUser = { id: user.id, role: user.role, name: user.name, email: user.email, authorId: user.author?.id ?? null };
  const token = signToken(authUser);
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', maxAge: 12 * 3600_000,
  });
  res.json({ data: { token, user: authUser } });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(TOKEN_COOKIE);
  res.status(204).end();
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ data: req.user });
});
