import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

// Initialize Stripe
function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET) {
    throw new Error('STRIPE_SECRET environment variable is required');
  }
  return new Stripe(process.env.STRIPE_SECRET, {
    apiVersion: '2023-10-16'
  });
}

// Helper function to get or create Stripe customer
async function getOrCreateStripeCustomer(uid: string, email: string): Promise<string> {
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
  
  // Ensure user document exists with basic info, then update
  await db.collection('users').doc(uid).set({
    uid,
    email,
    plan: 'free',
    createdAt: new Date(),
    ...updates
  }, { merge: true });
  
  return stripeCustomerId;
}

export async function POST(request: NextRequest) {
  try {
    const { uid, email } = await requireAuth(request);
    const { redirect_uri } = await request.json();
    
    // Get or create Stripe customer for this user and mode
    const stripeCustomerId = await getOrCreateStripeCustomer(uid, email);
    
    // Create checkout session
    const stripe = getStripe();
    
    // Build success and cancel URLs
    const baseUrl = process.env.SITE_DOMAIN || 'http://localhost:3000';
    const successUrl = redirect_uri 
      ? `${baseUrl}/billing?success=true&redirect_uri=${encodeURIComponent(redirect_uri)}`
      : `${baseUrl}/billing?success=true`;
    const cancelUrl = redirect_uri
      ? `${baseUrl}/billing?canceled=true&redirect_uri=${encodeURIComponent(redirect_uri)}`
      : `${baseUrl}/billing?canceled=true`;
    
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Fact Checker Pro',
            description: 'Unlimited fact checks with advanced AI analysis',
          },
          unit_amount: 999, // $9.99 in cents
          recurring: {
            interval: 'month',
          },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { 
        uid,
        // Include mode for webhook processing
        mode: process.env.STRIPE_SECRET?.startsWith('sk_test_') ? 'test' : 'live'
      },
      // Test mode settings
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
    });
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      return createAuthResponse(error.message);
    }
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
