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

// Stub fact-check function (replace with actual AI implementation)
async function factCheck(text: string): Promise<{ result: string; credibility: number; sources: string[] }> {
  // This is a placeholder - replace with actual AI fact-checking logic
  await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing time
  
  return {
    result: `This is a mock fact-check result for the text: "${text.substring(0, 100)}...". In a real implementation, this would use AI to analyze the content and provide factual accuracy assessment.`,
    credibility: 0.75,
    sources: [
      'Reuters Fact Check',
      'AP News Verification',
      'PolitiFact Analysis'
    ]
  };
}

export async function POST(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { text } = await request.json();
    
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    
    const today = todayUtc();
    const usageDocId = `${uid}_${today}`;
    
    // Get user plan
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = userData?.plan || 'free';
    
    // Check limits for free users
    if (plan === 'free') {
      const usageDoc = await db.collection('usage').doc(usageDocId).get();
      const usageData = usageDoc.data();
      const currentCount = usageData?.count || 0;
      const limit = parseInt(process.env.FREE_DAILY_LIMIT || '5');
      
      if (currentCount >= limit) {
        return NextResponse.json({
          error: 'quota_exceeded',
          used: currentCount,
          limit,
          resetsAt: resetsAtIso()
        }, { status: 402 });
      }
    }
    
    // Run fact check
    const result = await factCheck(text);
    
    // Increment usage counter for free users
    if (plan === 'free') {
      await db.collection('usage').doc(usageDocId).set({
        uid,
        day: today,
        count: (await db.collection('usage').doc(usageDocId).get()).data()?.count + 1 || 1,
        updatedAt: new Date()
      }, { merge: true });
    }
    
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      return createAuthResponse(error.message);
    }
    console.error('Error during fact check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
