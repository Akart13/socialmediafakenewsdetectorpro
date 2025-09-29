import { NextRequest, NextResponse } from 'next/server';

// CORS configuration
const ALLOWED_ORIGINS = new Set([
  'chrome-extension://abcdefghijklmnopqrstuvwxyz123456', // Replace with actual extension ID
  'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome', // Replace with actual extension ID
  'https://fact-checker-website.vercel.app',
  'http://localhost:3000'
]);

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && ALLOWED_ORIGINS.has(origin);
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Vary': 'Origin',
  };
}

export function handleCorsOptions(req: NextRequest): NextResponse {
  const origin = req.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

export function createCorsResponse(data: any, status: number = 200, origin?: string | null): NextResponse {
  const headers = getCorsHeaders(origin);
  return NextResponse.json(data, { status, headers });
}

export function createCorsErrorResponse(error: string, status: number = 500, origin?: string | null): NextResponse {
  return createCorsResponse({ error }, status, origin);
}