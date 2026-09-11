import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret';

export type UserSession = {
  id: string;
  email: string;
  username: string;
  role: string;
};

export function signToken(user: UserSession) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as UserSession;
}

export function getAuthToken(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function getCurrentUser(request: NextRequest) {
  const token = getAuthToken(request);

  if (!token) {
    return null;
  }

  try {
    const payload = verifyToken(token) as UserSession;
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true
      }
    });

    if (!user || user.status !== 'ACTIVE') {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
