import { NextRequest, NextResponse } from 'next/server';
import { getCorsHeaders, handleCorsOptions, createSessionCookie, registerUserViaAPI, createSessionFromIdToken, verifyIdTokenAndGetUser } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

/**
 * Handles CORS preflight OPTIONS requests for the unified auth endpoint.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {NextResponse} Response with CORS headers
 */
export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

/**
 * Handles POST requests for unified authentication that works for both website and extension.
 * Verifies Firebase ID token, optionally registers user, and creates session cookie.
 * 
 * @param {NextRequest} req - The incoming request object containing idToken
 * @returns {Promise<NextResponse>} Response with authentication status and session cookie
 */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = getCorsHeaders(origin);
    
    const { idToken, registerUser = false } = await req.json();
    
    if (!idToken) {
      return NextResponse.json({ error: "ID token required" }, { status: 400, headers });
    }

    // Verify the Firebase ID token and get user info
    const { uid, email } = await verifyIdTokenAndGetUser(idToken);
    console.log(`Unified auth: Authenticated user ${uid} (${email})`);

    // Register user in Firestore if requested (for extension auth)
    if (registerUser) {
      const registerResult = await registerUserViaAPI(idToken);
      if (!registerResult.success) {
        console.warn('User registration failed, but continuing with auth:', registerResult.error);
      }
    }

    // Create session cookie
    const sessionCookie = await createSessionFromIdToken(idToken);
    const response = NextResponse.json({ 
      ok: true,
      uid,
      email,
      message: 'Authentication successful'
    }, { headers });
    
    // Set session cookie
    createSessionCookie(response, sessionCookie);

    return response;
  } catch (error) {
    console.error('Unified auth error:', error);
    const origin = req.headers.get('origin');
    const headers = getCorsHeaders(origin);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500, headers });
  }
}
