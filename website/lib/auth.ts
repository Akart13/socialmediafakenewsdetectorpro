import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, JWTPayload } from './jwt';
import { adminAuth } from './firebaseAdmin';

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

export function createAuthResponse(error: string, status: number = 401) {
  return NextResponse.json({ error }, { status });
}
