import 'server-only'; // prevents client bundles from importing this file
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Requires an environment variable to be set, throwing an error if it's missing.
 * 
 * @param {string} name - The name of the environment variable to check
 * @returns {string} The value of the environment variable
 * @throws {Error} Throws error with message indicating the missing environment variable
 */
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert({
        projectId: requireEnv('FIREBASE_PROJECT_ID'),
        clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
        privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    });

/**
 * Initializes and exports Firebase Admin Firestore database instance.
 * Uses singleton pattern to avoid multiple initializations.
 */
export const db = getFirestore(app);

/**
 * Initializes and exports Firebase Admin Auth instance.
 * Used for server-side authentication operations.
 */
export const adminAuth = getAuth(app);