import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { requireAuth, createAuthResponse } from '@/lib/auth';
import Stripe from 'stripe';

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
    const { uid, email } = await requireAuth(request);
    
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
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_PRO!,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.SITE_DOMAIN}/billing?success=true`,
      cancel_url: `${process.env.SITE_DOMAIN}/billing?canceled=true`,
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
