import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, JWTPayload } from './jwt';
import { adminAuth } from './firebaseAdmin';

/**
 * Requires authentication by verifying either a Firebase ID token or custom JWT from the request.
 * First attempts Firebase token verification, then falls back to custom JWT verification.
 * 
 * @param {NextRequest} request - The incoming Next.js request object
 * @returns {Promise<JWTPayload>} Object containing uid and email from the verified token
 * @throws {Error} Throws error if authorization header is missing, invalid, or token verification fails
 */
export async function requireAuth(request: NextRequest): Promise<JWTPayload> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  
  try {
    // First try to verify as Firebase ID token
    const decodedToken = await adminAuth.verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email || ''
    };
  } catch (firebaseError) {
    // If Firebase verification fails, try as custom JWT
    try {
      return verifyToken(token);
    } catch (jwtError) {
      throw new Error('Invalid token format');
    }
  }
}

/**
 * Creates a standardized authentication error response.
 * 
 * @param {string} error - The error message to include in the response
 * @param {number} status - HTTP status code (defaults to 401 Unauthorized)
 * @returns {NextResponse} Next.js response object with error JSON
 */
export function createAuthResponse(error: string, status: number = 401) {
  return NextResponse.json({ error }, { status });
}
