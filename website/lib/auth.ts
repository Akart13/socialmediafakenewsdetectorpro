import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, JWTPayload } from './jwt';

export async function requireAuth(request: NextRequest): Promise<JWTPayload> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  return verifyToken(token);
}

export function createAuthResponse(error: string, status: number = 401) {
  return NextResponse.json({ error }, { status });
}
