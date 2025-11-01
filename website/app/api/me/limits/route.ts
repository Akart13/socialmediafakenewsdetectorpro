import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Returns today's date in UTC format as YYYY-MM-DD string.
 * 
 * @returns {string} Today's date in YYYY-MM-DD format
 */
function todayUtc(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Returns the ISO timestamp for when the daily quota resets (midnight UTC tomorrow).
 * 
 * @returns {string} ISO timestamp string for tomorrow at 00:00:00 UTC
 */
function resetsAtIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Handles GET requests to retrieve user's current usage limits and quota information.
 * Requires authentication via Bearer token or session cookie.
 * 
 * @param {NextRequest} request - The incoming request object
 * @returns {Promise<NextResponse>} Response with plan, used count, limit, and reset time
 */
export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const today = todayUtc();
    
    // Get user document
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = userData?.plan || 'free';
    
    console.log(`[LIMITS API] User ${uid} - Raw userData:`, userData);
    console.log(`[LIMITS API] User ${uid} - Plan: ${plan}`);
    
    // Get today's usage
    const usageDocId = `${uid}_${today}`;
    const usageDoc = await db.collection('usage').doc(usageDocId).get();
    const usageData = usageDoc.data();
    const used = usageData?.count || 0;
    
    const limit = plan === 'pro' ? null : parseInt(process.env.FREE_DAILY_LIMIT || '5');
    
    return NextResponse.json({
      plan,
      used,
      limit,
      resetsAt: resetsAtIso()
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      return createAuthResponse(error.message);
    }
    console.error('Error getting limits:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
