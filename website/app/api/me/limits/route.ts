import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';

function todayUtc(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function resetsAtIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const today = todayUtc();
    
    // Get user document
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = userData?.plan || 'free';
    
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
