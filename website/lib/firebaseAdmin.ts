import 'server-only'; // prevents client bundles from importing this file
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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

export const db = getFirestore(app);
export const adminAuth = getAuth(app);