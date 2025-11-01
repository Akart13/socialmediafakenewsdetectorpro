import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { adminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * Sets a refresh token as an HTTP-only cookie on the response.
 * The cookie is configured for cross-origin requests and expires in 30 days.
 * 
 * @param {NextResponse} res - The Next.js response object
 * @param {string} refreshToken - The refresh token to set as a cookie
 */
function setRefreshCookie(res: NextResponse, refreshToken: string) {
  res.headers.append(
    'Set-Cookie',
    [
      `rt=${encodeURIComponent(refreshToken)}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=None',
      `Max-Age=${60*60*24*30}` // 30 days
    ].join('; ')
  );
}

/**
 * Generates CORS headers based on the request origin.
 * Allows requests from whitelisted origins.
 * 
 * @param {string|null} origin - The origin header from the request
 * @returns {Record<string, string>} Object containing CORS headers
 */
function cors(origin: string | null) {
  const allow = new Set([
    'chrome-extension://abcdefghijklmnopqrstuvwxyz123456', // Replace with actual extension ID
    'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome', // Replace with actual extension ID
    'https://fact-checker-website.vercel.app',
    'http://localhost:3000'
  ]);
  
  const ok = origin && allow.has(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : '',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

/**
 * Handles CORS preflight OPTIONS requests for the finalize endpoint.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {NextResponse} Response with CORS headers
 */
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * Handles POST requests to finalize authentication by verifying Firebase ID token
 * and issuing JWT access and refresh tokens. Used primarily for extension authentication.
 * 
 * @param {NextRequest} req - The incoming request object with Firebase ID token in Authorization header
 * @returns {Promise<NextResponse>} Response with access token and refresh cookie
 */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    
    // Get Firebase ID token from Authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401, headers });
    }

    const firebaseToken = authHeader.substring(7);
    
    // Verify Firebase ID token
    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);
    const { uid, email } = decodedToken;

    // Issue short-lived access token (client will store this)
    const access = jwt.sign({ sub: uid, email }, process.env.APP_JWT_SECRET!, {
      algorithm: 'HS256',
      expiresIn: '45m',
    });

    // Issue long-lived refresh token (store server-side if you prefer rotation)
    const refresh = jwt.sign({ sub: uid, typ: 'refresh' }, process.env.APP_JWT_SECRET!, {
      algorithm: 'HS256',
      expiresIn: '30d',
    });

    const res = NextResponse.json({ access }, { headers });
    setRefreshCookie(res, refresh);
    return res;
  } catch (error) {
    console.error('Auth finalize error:', error);
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401, headers });
  }
}
