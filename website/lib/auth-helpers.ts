import { NextResponse } from 'next/server';
import { getAuth } from "firebase-admin/auth";

export const runtime = 'nodejs';

// Create session cookie with proper settings
export function createSessionCookie(response: NextResponse, sessionCookie: string) {
  const expiresIn = 14 * 24 * 60 * 60; // 14 days in seconds
  
  response.cookies.set('__session', sessionCookie, {
    path: '/',
    maxAge: expiresIn,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'none', // Required for cross-origin requests from extension
    domain: process.env.NODE_ENV === 'production' ? '.fact-checker-website.vercel.app' : undefined
  });
}

// Call the unified /api/me endpoint to register a user
export async function registerUserViaAPI(idToken: string) {
  try {
    const registerResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/me`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ action: 'register' })
    });

    if (registerResponse.ok) {
      const registerResult = await registerResponse.json();
      console.log('User registration successful:', registerResult);
      return { success: true, result: registerResult };
    } else {
      const errorText = await registerResponse.text();
      console.error('Failed to register user:', registerResponse.status, errorText);
      return { success: false, error: errorText };
    }
  } catch (error: any) {
    console.error('Error calling user registration:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Create session cookie from ID token
export async function createSessionFromIdToken(idToken: string) {
  const expiresIn = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
  return await getAuth().createSessionCookie(idToken, { expiresIn });
}

// Verify ID token and get user info
export async function verifyIdTokenAndGetUser(idToken: string) {
  const decodedToken = await getAuth().verifyIdToken(idToken);
  return {
    uid: decodedToken.uid,
    email: decodedToken.email || ''
  };
}
