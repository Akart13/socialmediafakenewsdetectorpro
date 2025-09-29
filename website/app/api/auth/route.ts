import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { adminAuth } from '@/lib/firebaseAdmin';
import { getCorsHeaders, handleCorsOptions, createCorsResponse, createCorsErrorResponse } from '@/lib/cors';
import { verifyIdTokenAndGetUser, registerUserViaAPI, createSessionFromIdToken, createSessionCookie } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

// Set refresh cookie helper
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

// Clear refresh cookie helper
function clearRefreshCookie(res: NextResponse) {
  res.headers.append('Set-Cookie', 'rt=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    const headers = getCorsHeaders(origin);
    
    const { action, idToken, refreshToken, registerUser = false } = await req.json();
    
    switch (action) {
      case 'finalize':
        return await handleFinalize(req, headers, idToken);
      
      case 'session':
        return await handleSession(req, headers, idToken);
      
      case 'refresh':
        return await handleRefresh(req, headers, refreshToken);
      
      case 'logout':
        return await handleLogout(req, headers);
      
      case 'unified':
        return await handleUnified(req, headers, idToken, registerUser);
      
      case 'extension':
        return await handleExtension(req, headers, idToken);
      
      default:
        return createCorsErrorResponse('Invalid action', 400, origin);
    }
  } catch (error) {
    console.error('Auth error:', error);
    const origin = req.headers.get('origin');
    return createCorsErrorResponse('Authentication failed', 500, origin);
  }
}

// Handle JWT-based authentication finalization
async function handleFinalize(req: NextRequest, headers: Record<string, string>, idToken?: string) {
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
}

// Handle session cookie creation
async function handleSession(req: NextRequest, headers: Record<string, string>, idToken?: string) {
  if (!idToken) {
    return NextResponse.json({ error: "ID token required" }, { status: 400, headers });
  }

  // Create session cookie
  const sessionCookie = await createSessionFromIdToken(idToken);
  const response = NextResponse.json({ ok: true }, { headers });
  
  // Set session cookie
  createSessionCookie(response, sessionCookie);
  return response;
}

// Handle token refresh
async function handleRefresh(req: NextRequest, headers: Record<string, string>, refreshToken?: string) {
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

// Handle logout
async function handleLogout(req: NextRequest, headers: Record<string, string>) {
  const res = new NextResponse(null, { status: 204, headers });
  clearRefreshCookie(res);
  return res;
}

// Handle unified authentication
async function handleUnified(req: NextRequest, headers: Record<string, string>, idToken?: string, registerUser?: boolean) {
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
}

// Handle extension-specific authentication
async function handleExtension(req: NextRequest, headers: Record<string, string>, idToken?: string) {
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
}
