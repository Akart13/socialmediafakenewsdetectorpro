import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-utils';
import { withCors } from '@/lib/cors';
import { db } from '@/lib/firebaseAdmin';
import Stripe from 'stripe';

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

async function handler(request: NextRequest) {
  try {
    const { uid, email } = await requireAuth(request);
    const { redirect_uri } = await request.json();
    
    console.log('Customer portal request for user:', uid);
    
    // Get user's Stripe customer ID
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    
    if (!userData) {
      console.log('User not found in database');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Determine if we're in test or live mode
    const isTestMode = process.env.STRIPE_SECRET?.startsWith('sk_test_');
    
    // Access nested customer ID based on mode
    let stripeCustomerId;
    if (isTestMode) {
      stripeCustomerId = userData.stripe?.test?.customerId || userData.stripeTestCustomerId;
    } else {
      stripeCustomerId = userData.stripe?.live?.customerId || userData.stripeCustomerId;
    }
    
    console.log('Stripe customer ID:', stripeCustomerId, 'Mode:', isTestMode ? 'test' : 'live');
    
    if (!stripeCustomerId) {
      console.log('No Stripe customer ID found for user');
      return NextResponse.json({ error: 'No Stripe customer found. Please upgrade to Pro first.' }, { status: 404 });
    }
    
    // Create customer portal session
    const stripe = getStripe();
    const baseUrl = process.env.SITE_DOMAIN || 'http://localhost:3000';
    const returnUrl = redirect_uri || `${baseUrl}/billing`;
    
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Customer portal error:', error);
    return NextResponse.json({ error: 'Failed to create customer portal session' }, { status: 500 });
  }
}

export const POST = withCors(handler);
