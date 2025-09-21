import jwt from 'jsonwebtoken';

export interface JWTPayload {
  uid: string;
  email: string;
}

export function signToken(payload: JWTPayload): string {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error('APP_JWT_SECRET environment variable is required');
  }
  return jwt.sign(payload, secret, { expiresIn: '24h' });
}

export function verifyToken(token: string): JWTPayload {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error('APP_JWT_SECRET environment variable is required');
  }
  return jwt.verify(token, secret) as JWTPayload;
}
