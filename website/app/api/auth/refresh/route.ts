import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';

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

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  return new NextResponse(null, { status: 200, headers });
}

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
