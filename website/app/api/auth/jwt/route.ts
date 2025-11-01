import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getCorsHeaders, handleCorsOptions } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

/**
 * Handles CORS preflight OPTIONS requests for the JWT auth endpoint.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {NextResponse} Response with CORS headers
 */
export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

/**
 * Handles POST requests for JWT-based authentication with multiple actions.
 * Supports finalize (create tokens), logout, and refresh actions.
 * 
 * @param {NextRequest} req - The incoming request object containing action and tokens
 * @returns {Promise<NextResponse>} Response based on the requested action
 */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = getCorsHeaders(origin);
    
    const { action, idToken, refreshToken } = await req.json();
    
    switch (action) {
      case 'finalize':
        return await handleFinalize(req, headers, idToken);
      
      case 'logout':
        return await handleLogout(headers);
      
      case 'refresh':
        return await handleRefresh(req, headers, refreshToken);
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers });
    }
  } catch (error) {
    console.error('JWT auth error:', error);
    const origin = req.headers.get('origin');
    const headers = getCorsHeaders(origin);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500, headers });
  }
}

/**
 * Handles the finalize action for JWT authentication.
 * Verifies Firebase ID token and issues access and refresh tokens.
 * 
 * @param {NextRequest} req - The incoming request object
 * @param {Record<string, string>} headers - CORS headers to include in response
 * @param {string} idToken - Optional Firebase ID token (can also come from Authorization header)
 * @returns {Promise<NextResponse>} Response with access token and refresh cookie
 */
async function handleFinalize(req: NextRequest, headers: Record<string, string>, idToken?: string) {
  // Get Firebase ID token from Authorization header if not in body
  const authHeader = req.headers.get('authorization');
  const firebaseToken = idToken || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null);
  
  if (!firebaseToken) {
    return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401, headers });
  }

  // Verify Firebase ID token
  const decodedToken = await adminAuth.verifyIdToken(firebaseToken);
  const { uid, email } = decodedToken;

  // Issue short-lived access token
  const access = jwt.sign({ sub: uid, email }, process.env.APP_JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '45m',
  });

  // Issue long-lived refresh token
  const refresh = jwt.sign({ sub: uid, typ: 'refresh' }, process.env.APP_JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });

  const res = NextResponse.json({ access }, { headers });
  setRefreshCookie(res, refresh);
  return res;
}

/**
 * Handles the logout action by clearing the refresh token cookie.
 * 
 * @param {Record<string, string>} headers - CORS headers to include in response
 * @returns {NextResponse} Response with cleared refresh cookie
 */
async function handleLogout(headers: Record<string, string>) {
  const res = new NextResponse(null, { status: 204, headers });
  res.headers.append('Set-Cookie', 'rt=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
  return res;
}

/**
 * Handles the refresh action to issue a new access token from a refresh token.
 * Validates the refresh token and issues a new short-lived access token.
 * 
 * @param {NextRequest} req - The incoming request object
 * @param {Record<string, string>} headers - CORS headers to include in response
 * @param {string} refreshToken - Optional refresh token (can also come from cookie)
 * @returns {Promise<NextResponse>} Response with new access token or error
 */
async function handleRefresh(req: NextRequest, headers: Record<string, string>, refreshToken?: string) {
  const cookie = req.headers.get('cookie') || '';
  const match = refreshToken || cookie.match(/(?:^|;\s*)rt=([^;]+)/)?.[1];
  
  if (!match) {
    return NextResponse.json({ error: 'no_refresh' }, { status: 401, headers });
  }

  try {
    const decoded = jwt.verify(decodeURIComponent(match), process.env.APP_JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as any;

    if (decoded.typ !== 'refresh') {
      throw new Error('bad_typ');
    }

    // Issue new access token
    const access = jwt.sign({ sub: decoded.sub, email: decoded.email }, process.env.APP_JWT_SECRET!, {
      algorithm: 'HS256',
      expiresIn: '45m',
    });
    
    return NextResponse.json({ access }, { headers });
  } catch (jwtError) {
    console.error('JWT verification failed:', jwtError);
    return NextResponse.json({ error: 'invalid_refresh' }, { status: 401, headers });
  }
}

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
