import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
let app: any;
let db: any;
let adminAuth: any;

try {
  if (getApps().length === 0) {
    // Check if we have the required environment variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      console.log('Initializing Firebase Admin with environment variables');
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      console.log('Firebase Admin environment variables not found, skipping initialization');
      // Don't initialize Firebase Admin if we don't have the required env vars
      app = null;
    }
  } else {
    app = getApp();
  }
  
  if (app) {
    db = getFirestore(app);
    adminAuth = getAuth(app);
    console.log('Firebase Admin initialized successfully');
  } else {
    console.log('Firebase Admin not initialized - missing environment variables');
    db = null;
    adminAuth = null;
  }
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
  // Export null values that will cause graceful failures
  db = null;
  adminAuth = null;
}

export { db, adminAuth };
