import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, createSessionCookie, createSessionFromIdToken } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

/**
 * Handles POST requests to create a session cookie from a Firebase ID token.
 * Used for maintaining authentication state across requests.
 * 
 * @param {NextRequest} request - The incoming request object containing idToken
 * @returns {Promise<NextResponse>} Response with session cookie set
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    const headers = getCorsHeaders(origin);
    
    const { idToken } = await request.json();
    
    if (!idToken) {
      return NextResponse.json({ error: "ID token required" }, { status: 400, headers });
    }

    // Create session cookie
    const sessionCookie = await createSessionFromIdToken(idToken);
    const response = NextResponse.json({ ok: true }, { headers });
    
    // Set session cookie
    createSessionCookie(response, sessionCookie);

    return response;
  } catch (error) {
    console.error('Error creating session cookie:', error);
    const origin = request.headers.get('origin');
    const headers = getCorsHeaders(origin);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500, headers });
  }
}
