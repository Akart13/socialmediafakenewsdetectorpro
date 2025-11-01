import jwt from 'jsonwebtoken';

export interface JWTPayload {
  uid: string;
  email: string;
}

/**
 * Signs a JWT token with user payload information.
 * The token expires after 24 hours.
 * 
 * @param {JWTPayload} payload - Object containing uid and email to encode in the token
 * @returns {string} Signed JWT token string
 * @throws {Error} Throws error if APP_JWT_SECRET environment variable is not set
 */
export function signToken(payload: JWTPayload): string {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error('APP_JWT_SECRET environment variable is required');
  }
  return jwt.sign(payload, secret, { 
    expiresIn: '24h',
    algorithm: 'HS256'
  });
}

/**
 * Verifies and decodes a JWT token, returning the payload.
 * 
 * @param {string} token - The JWT token string to verify
 * @returns {JWTPayload} Decoded token payload containing uid and email
 * @throws {Error} Throws error if APP_JWT_SECRET is not set or token verification fails
 */
export function verifyToken(token: string): JWTPayload {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error('APP_JWT_SECRET environment variable is required');
  }
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JWTPayload;
}
