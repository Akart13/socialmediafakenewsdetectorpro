import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

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
 * Handles CORS preflight OPTIONS requests for the refresh endpoint.
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
 * Handles POST requests to refresh an access token using a refresh token from cookie.
 * Validates the refresh token and issues a new short-lived access token.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {Promise<NextResponse>} Response with new access token or error
 */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    
    const cookie = req.headers.get('cookie') || '';
    const match = cookie.match(/(?:^|;\s*)rt=([^;]+)/);
    
    if (!match) {
      return NextResponse.json({ error: 'no_refresh' }, { status: 401, headers });
    }

    try {
      const decoded = jwt.verify(decodeURIComponent(match[1]), process.env.APP_JWT_SECRET!, {
        algorithms: ['HS256'],
      }) as any;

      if (decoded.typ !== 'refresh') {
        throw new Error('bad_typ');
      }

      // (Optional) rotate refresh here: set a new cookie
      // For now, we'll keep the same refresh token

      const access = jwt.sign({ sub: decoded.sub, email: decoded.email }, process.env.APP_JWT_SECRET!, {
        algorithm: 'HS256',
        expiresIn: '45m',
      });
      
      return NextResponse.json({ access }, { headers });
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return NextResponse.json({ error: 'invalid_refresh' }, { status: 401, headers });
    }
  } catch (error) {
    console.error('Auth refresh error:', error);
    const origin = req.headers.get('origin');
    const headers = cors(origin);
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500, headers });
  }
}
