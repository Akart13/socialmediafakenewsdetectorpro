import { getAuth } from "firebase-admin/auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();
    
    if (!idToken) {
      return NextResponse.json({ error: "ID token required" }, { status: 400 });
    }

    const expiresIn = 14 * 24 * 60 * 60 * 1000; // 14 days
    const sessionCookie = await getAuth().createSessionCookie(idToken, { expiresIn });

    const response = NextResponse.json({ ok: true });
    
    // Set session cookie with proper CORS settings
    response.cookies.set('__session', sessionCookie, {
      path: '/',
      maxAge: expiresIn / 1000,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'none', // Required for cross-origin requests from extension
      domain: process.env.NODE_ENV === 'production' ? '.fact-checker-website.vercel.app' : undefined
    });

    return response;
  } catch (error) {
    console.error('Error creating session cookie:', error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
