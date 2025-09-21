import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    // For production deployments (e.g., Vercel, Render)
    // Firebase Admin SDK will auto-initialize with environment variables
    initializeApp();
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    // Continue without Firebase for now - will fail gracefully on Firebase calls
  }
}

export const db = getFirestore();
export const adminAuth = getAuth();
