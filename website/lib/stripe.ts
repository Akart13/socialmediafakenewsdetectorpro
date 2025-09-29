import Stripe from 'stripe';
import { db } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// Initialize Stripe
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET) {
    throw new Error('STRIPE_SECRET environment variable is required');
  }
  return new Stripe(process.env.STRIPE_SECRET, {
    apiVersion: '2023-10-16'
  });
}

// Helper function to get or create Stripe customer
export async function getOrCreateStripeCustomer(uid: string, email: string): Promise<string> {
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.data();
  
  // Determine if we're in test or live mode
  const isTestMode = process.env.STRIPE_SECRET?.startsWith('sk_test_');
  const customerField = isTestMode ? 'stripe.test.customerId' : 'stripe.live.customerId';
  let stripeCustomerId = userData?.[customerField];
  
  // If no customer ID found, check for old field names and migrate them
  if (!stripeCustomerId) {
    if (isTestMode && userData?.stripeTestCustomerId) {
      // Migrate old test customer ID
      stripeCustomerId = userData.stripeTestCustomerId;
      console.log(`Migrating old test customer ID for user ${uid}: ${stripeCustomerId}`);
    } else if (!isTestMode && userData?.stripeCustomerId) {
      // Migrate old live customer ID
      stripeCustomerId = userData.stripeCustomerId;
      console.log(`Migrating old live customer ID for user ${uid}: ${stripeCustomerId}`);
    }
  }
  
  // If still no customer ID, create one
  if (!stripeCustomerId) {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email,
      metadata: { 
        uid,
        mode: isTestMode ? 'test' : 'live'
      }
    });
    stripeCustomerId = customer.id;
    console.log(`Created new ${isTestMode ? 'test' : 'live'} customer for user ${uid}: ${stripeCustomerId}`);
  }
  
  // Update user document with new field structure and clean up old fields
  const updates = {
    [customerField]: stripeCustomerId,
    updatedAt: new Date()
  };
  
  // Clean up old field names
  if (userData?.stripeCustomerId || userData?.stripeTestCustomerId) {
    if (isTestMode && userData?.stripeCustomerId) {
      updates['stripeCustomerId'] = FieldValue.delete();
    }
    if (userData?.stripeTestCustomerId) {
      updates['stripeTestCustomerId'] = FieldValue.delete();
    }
  }
  
  // Update user document with Stripe customer info
  await db.collection('users').doc(uid).update(updates);
  
  return stripeCustomerId;
}

// Helper function to update user subscription status
export async function updateUserSubscriptionStatus(
  uid: string, 
  plan: 'free' | 'pro', 
  subscriptionStatus: string,
  stripeCustomerId?: string
): Promise<void> {
  const updates: any = {
    plan,
    subscriptionStatus,
    updatedAt: new Date()
  };
  
  if (stripeCustomerId) {
    const isTestMode = process.env.STRIPE_SECRET?.startsWith('sk_test_');
    const customerField = isTestMode ? 'stripe.test.customerId' : 'stripe.live.customerId';
    updates[customerField] = stripeCustomerId;
  }
  
  await db.collection('users').doc(uid).set(updates, { merge: true });
}

// Helper function to find user by Stripe customer ID
export async function findUserByStripeCustomerId(customerId: string): Promise<string | null> {
  const isTestMode = process.env.STRIPE_SECRET?.startsWith('sk_test_');
  const customerField = isTestMode ? 'stripe.test.customerId' : 'stripe.live.customerId';
  
  // Try new field structure first
  let snap = await db.collection('users').where(customerField, '==', customerId).limit(1).get();
  
  if (snap.empty) {
    // Fallback to old field names
    snap = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
  }
  
  return snap.empty ? null : snap.docs[0].id;
}
