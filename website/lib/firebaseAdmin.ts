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
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      // For development without proper env vars, initialize with default
      app = initializeApp();
    }
  } else {
    app = getApp();
  }
  
  db = getFirestore(app);
  adminAuth = getAuth(app);
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
  // Export null values that will cause graceful failures
  db = null;
  adminAuth = null;
}

export { db, adminAuth };
