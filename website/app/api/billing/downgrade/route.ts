import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    console.log('Downgrade API called');
    const { uid } = await requireAuth(request);
    console.log(`Downgrading user: ${uid}`);
    
    // Update user document to set plan to 'free'
    await db.collection('users').doc(uid).update({
      plan: 'free',
      updatedAt: new Date()
    });
    
    console.log(`Successfully downgraded user to free plan: ${uid}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully downgraded to Free plan'
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      console.error('Authorization error:', error.message);
      return createAuthResponse(error.message);
    }
    console.error('Error downgrading user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
