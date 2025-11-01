import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from "firebase-admin/auth";
import { db } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * Generates CORS headers based on the request origin.
 * Allows requests from whitelisted origins including Chrome extensions and the website.
 * 
 * @param {string|null} origin - The origin header from the request, or null if not present
 * @returns {Record<string, string>} Object containing CORS headers
 */
export function getCorsHeaders(origin: string | null) {
  const allowedOrigins = new Set([
    'chrome-extension://abcdefghijklmnopqrstuvwxyz123456', // Replace with actual extension ID
    'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome', // Replace with actual extension ID
    'https://fact-checker-website.vercel.app',
    'http://localhost:3000'
  ]);
  
  const isAllowed = origin && allowedOrigins.has(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

/**
 * Handles CORS preflight OPTIONS requests by returning appropriate CORS headers.
 * This is required for cross-origin requests from Chrome extensions.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {NextResponse} Response with CORS headers and 200 status
 */
export function handleCorsOptions(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * Sets a session cookie on the response with appropriate security settings.
 * The cookie is configured for cross-origin requests from Chrome extensions.
 * 
 * @param {NextResponse} response - The Next.js response object to set the cookie on
 * @param {string} sessionCookie - The Firebase session cookie value to set
 */
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

/**
 * Registers a new user in Firestore by calling the user registration API endpoint.
 * This creates a user document with default plan settings.
 * 
 * @param {string} idToken - Firebase ID token for authentication
 * @returns {Promise<Object>} Object with success boolean and result or error message
 */
export async function registerUserViaAPI(idToken: string) {
  try {
    const registerResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/users/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      }
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

/**
 * Creates a Firebase session cookie from a Firebase ID token.
 * The session cookie expires after 14 days.
 * 
 * @param {string} idToken - Firebase ID token to convert to session cookie
 * @returns {Promise<string>} The session cookie string
 */
export async function createSessionFromIdToken(idToken: string) {
  const expiresIn = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
  return await getAuth().createSessionCookie(idToken, { expiresIn });
}

/**
 * Verifies a Firebase ID token and extracts user information.
 * 
 * @param {string} idToken - Firebase ID token to verify
 * @returns {Promise<Object>} Object containing uid and email from the decoded token
 */
export async function verifyIdTokenAndGetUser(idToken: string) {
  const decodedToken = await getAuth().verifyIdToken(idToken);
  return {
    uid: decodedToken.uid,
    email: decodedToken.email || ''
  };
}
