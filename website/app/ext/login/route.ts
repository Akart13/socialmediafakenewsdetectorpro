import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import jwt from 'jsonwebtoken';

// Initialize Firebase Admin for server-side operations
if (!getApps().length) {
  const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccount) {
    initializeApp({
      credential: cert(require(serviceAccount))
    });
  } else {
    // For production deployments
    initializeApp();
  }
}

const JWT_SECRET: string = process.env.APP_JWT_SECRET || 'fallback-secret-for-development-only';

if (!process.env.APP_JWT_SECRET) {
  console.warn('WARNING: APP_JWT_SECRET environment variable not set. Using fallback secret for development.');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const redirectUri = searchParams.get('redirect_uri');
    
    if (!redirectUri) {
      return NextResponse.json({ error: 'Missing redirect_uri parameter' }, { status: 400 });
    }

    // Get the Firebase session token from cookies or Authorization header
    const authHeader = request.headers.get('authorization');
    const sessionCookie = request.cookies.get('__session')?.value;
    
    let uid: string;
    let email: string;
    
    if (authHeader?.startsWith('Bearer ')) {
      // Handle Firebase ID token from Authorization header
      const idToken = authHeader.substring(7);
      try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        uid = decodedToken.uid;
        email = decodedToken.email || '';
      } catch (error) {
        console.error('Invalid ID token:', error);
        return NextResponse.redirect(new URL(`/auth?redirect_uri=${encodeURIComponent(redirectUri)}`, request.url));
      }
    } else if (sessionCookie) {
      // Handle Firebase session cookie
      try {
        const decodedToken = await getAuth().verifySessionCookie(sessionCookie);
        uid = decodedToken.uid;
        email = decodedToken.email || '';
      } catch (error) {
        console.error('Invalid session cookie:', error);
        return NextResponse.redirect(new URL(`/auth?redirect_uri=${encodeURIComponent(redirectUri)}`, request.url));
      }
    } else {
      // No authentication found, redirect to login
      return NextResponse.redirect(new URL(`/auth?redirect_uri=${encodeURIComponent(redirectUri)}`, request.url));
    }

    // Create app JWT token
    const appToken = jwt.sign(
      { uid, email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Redirect to extension with token
    const redirectUrl = new URL(redirectUri);
    redirectUrl.hash = `token=${appToken}`;
    
    const response = NextResponse.redirect(redirectUrl.toString());
    
    // Add CORS headers for extension compatibility
    response.headers.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    response.headers.set('Cross-Origin-Opener-Policy', 'unsafe-none');
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return response;
    
  } catch (error) {
    console.error('Extension login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle POST requests (for form submissions)
export async function POST(request: NextRequest) {
  return GET(request);
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  
  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
  response.headers.set('Cross-Origin-Opener-Policy', 'unsafe-none');
  response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  
  return response;
}
