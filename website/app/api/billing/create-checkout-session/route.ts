import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, createAuthResponse } from '@/lib/auth';
import { getStripe, getOrCreateStripeCustomer } from '@/lib/stripe';
import { createCorsResponse, createCorsErrorResponse } from '@/lib/cors';

export const runtime = 'nodejs';

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
    
    return createCorsResponse({ url: session.url });
  } catch (error) {
    if (error instanceof Error && error.message.includes('authorization')) {
      return createAuthResponse(error.message);
    }
    console.error('Error creating checkout session:', error);
    return createCorsErrorResponse('Internal server error', 500);
  }
}
