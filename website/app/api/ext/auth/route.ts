import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';
import jwt from 'jsonwebtoken';

// Initialize Firebase Admin for server-side operations
if (!getApps().length) {
  initializeApp();
}

const JWT_SECRET: string = process.env.APP_JWT_SECRET || 'fallback-secret-for-development-only';

if (!process.env.APP_JWT_SECRET) {
  console.warn('WARNING: APP_JWT_SECRET environment variable not set. Using fallback secret for development.');
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }

    const idToken = authHeader.substring(7);
    
    // Verify the Firebase ID token
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email || '';

    // Get the state from request body
    const body = await request.json();
    const state = body.state;

    if (!state) {
      return NextResponse.json({ error: 'Missing state parameter' }, { status: 400 });
    }

    // Create app JWT token
    const appToken = jwt.sign(
      { uid, email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return NextResponse.json({ 
      appToken,
      uid,
      email 
    });
    
  } catch (error) {
    console.error('Extension auth error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
