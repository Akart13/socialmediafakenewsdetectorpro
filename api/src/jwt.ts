import jwt from 'jsonwebtoken';

const JWT_SECRET: string = process.env.APP_JWT_SECRET || 'fallback-secret-for-development-only';

if (!process.env.APP_JWT_SECRET) {
  console.warn('WARNING: APP_JWT_SECRET environment variable not set. Using fallback secret for development.');
}

export interface JWTPayload {
  uid: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}
