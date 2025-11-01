import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

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
 * Handles CORS preflight OPTIONS requests for the logout endpoint.
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
 * Handles POST requests to log out by clearing the refresh token cookie.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {Promise<NextResponse>} Response with cleared refresh cookie
 */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    
    const res = new NextResponse(null, { status: 204, headers });
    res.headers.append('Set-Cookie', 'rt=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
    return res;
  } catch (error) {
    console.error('Auth logout error:', error);
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500, headers });
  }
}
