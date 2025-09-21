import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';
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

export async function POST(request: NextRequest) {
  try {
    if (!db) {
      return NextResponse.json({ error: 'Firebase Admin not initialized. Please check environment variables.' }, { status: 500 });
    }
    
    const { uid, email } = await requireAuth(request);
    const { redirect_uri } = await request.json();
    
    // Get or create Stripe customer
    let userDoc = await db.collection('users').doc(uid).get();
    let userData = userDoc.data();
    let stripeCustomerId = userData?.stripeCustomerId;
    
    if (!stripeCustomerId) {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email,
        metadata: { uid }
      });
      stripeCustomerId = customer.id;
      
      // Update user document with Stripe customer ID
      await db.collection('users').doc(uid).set({
        stripeCustomerId,
        updatedAt: new Date()
      }, { merge: true });
    }
    
    // Create checkout session
    const stripe = getStripe();
    
    // Build success and cancel URLs
    const baseUrl = `${process.env.SITE_DOMAIN}/billing`;
    const successUrl = redirect_uri 
      ? `${baseUrl}?success=true&redirect_uri=${encodeURIComponent(redirect_uri)}`
      : `${baseUrl}?success=true`;
    const cancelUrl = redirect_uri
      ? `${baseUrl}?canceled=true&redirect_uri=${encodeURIComponent(redirect_uri)}`
      : `${baseUrl}?canceled=true`;
    
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_PRO!,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { uid }
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
