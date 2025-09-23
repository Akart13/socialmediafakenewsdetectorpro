import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    console.log('Testing Firestore connection...');
    
    // Test reading from Firestore
    const testDoc = await db.collection('test').doc('connection').get();
    console.log('Firestore read test successful');
    
    // Test writing to Firestore
    await db.collection('test').doc('connection').set({
      timestamp: new Date(),
      message: 'Firestore connection test'
    });
    console.log('Firestore write test successful');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Firestore connection working',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Firestore test failed:', error);
    return NextResponse.json({ 
      error: 'Firestore connection failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
