import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    console.log('Registration API called');
    const { uid, email } = await requireAuth(request);
    console.log(`Authenticated user: ${uid} (${email})`);
    
    // Wait for Firebase Auth to fully propagate
    console.log('Waiting for Firebase Auth to fully propagate...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds
    console.log('Proceeding with Firestore document creation...');
    
    // Check if user already exists
    const userDoc = await db.collection('users').doc(uid).get();
    console.log(`User document exists: ${userDoc.exists}`);
    
    if (userDoc.exists) {
      // User already exists, just return success
      console.log('User already registered in Firestore');
      return NextResponse.json({ 
        success: true, 
        message: 'User already registered',
        user: userDoc.data()
      });
    }
    
    // Create new user document - all users start as pro by default
    const userData = {
      uid,
      email,
      plan: 'pro',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('Creating new user document in Firestore:', userData);
    await db.collection('users').doc(uid).set(userData);
    
    console.log(`Successfully created new user in Firestore: ${uid} (${email})`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'User registered successfully',
      user: {
        uid,
        email,
        plan: 'pro'
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      console.error('Authorization error:', error.message);
      return createAuthResponse(error.message);
    }
    console.error('Error registering user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
