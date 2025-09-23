import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    
    // Get user document
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    
    console.log(`[DEBUG] User ${uid} - Full user document:`, userData);
    
    return NextResponse.json({ 
      uid,
      userData,
      plan: userData?.plan || 'free',
      hasDocument: userDoc.exists
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      console.error('Authorization error:', error.message);
      return createAuthResponse(error.message);
    }
    console.error('Error getting user data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { plan } = await request.json();
    
    if (!plan || !['free', 'pro'].includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan. Must be "free" or "pro"' }, { status: 400 });
    }
    
    // Update user document
    await db.collection('users').doc(uid).update({
      plan,
      updatedAt: new Date()
    });
    
    console.log(`[DEBUG] Manually updated user ${uid} to plan: ${plan}`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully updated user to ${plan} plan`,
      uid,
      plan
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      console.error('Authorization error:', error.message);
      return createAuthResponse(error.message);
    }
    console.error('Error updating user plan:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
