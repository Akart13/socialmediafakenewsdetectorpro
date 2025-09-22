import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { signToken } from '@/lib/jwt';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }

    const idToken = authHeader.substring(7);
    
    // Verify the Firebase ID token
    const decodedToken = await adminAuth.verifyIdToken(idToken);
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
      process.env.APP_JWT_SECRET!,
      { 
        expiresIn: '24h',
        algorithm: 'HS256'
      }
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
