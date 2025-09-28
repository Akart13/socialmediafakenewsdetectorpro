import { NextRequest, NextResponse } from 'next/server';
import { getCorsHeaders, createSessionCookie, createSessionFromIdToken, verifyIdTokenAndGetUser, registerUserViaAPI } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    const headers = getCorsHeaders(origin);
    
    const { idToken } = await request.json();
    
    if (!idToken) {
      return NextResponse.json({ error: "ID token required" }, { status: 400, headers });
    }

    // Verify the Firebase ID token and get user info
    const { uid, email } = await verifyIdTokenAndGetUser(idToken);
    console.log(`Extension auth: Authenticated user ${uid} (${email})`);

    // Register user in Firestore using the existing /api/users/register endpoint
    const registerResult = await registerUserViaAPI(idToken);
    if (!registerResult.success) {
      console.warn('User registration failed, but continuing with auth:', registerResult.error);
    }

    // Create session cookie
    const sessionCookie = await createSessionFromIdToken(idToken);

    const response = NextResponse.json({ 
      ok: true,
      uid,
      email,
      message: 'Extension authentication successful'
    }, { headers });
    
    // Set session cookie
    createSessionCookie(response, sessionCookie);

    return response;
  } catch (error) {
    console.error('Extension auth error:', error);
    const origin = request.headers.get('origin');
    const headers = getCorsHeaders(origin);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500, headers });
  }
}
