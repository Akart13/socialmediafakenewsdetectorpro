import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  const sig = request.headers.get('stripe-signature') as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  let event: Stripe.Event;
  
  try {
    // Get raw body for webhook signature verification
    const body = await request.text();
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return new NextResponse('Webhook signature verification failed', { status: 400 });
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.metadata?.uid;
        const mode = session.metadata?.mode;
        
        if (uid && session.customer) {
          // Determine the customer field based on mode
          const isTestMode = mode === 'test' || process.env.STRIPE_SECRET?.startsWith('sk_test_');
          const customerField = isTestMode ? 'stripe.test.customerId' : 'stripe.live.customerId';
          
          // Update user with plan and ensure customer ID is saved
          await db.collection('users').doc(uid).update({
            plan: 'pro',
            [customerField]: session.customer,
            updatedAt: new Date()
          });
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Determine if this is a test or live customer
        const isTestMode = process.env.STRIPE_SECRET?.startsWith('sk_test_');
        const customerField = isTestMode ? 'stripe.test.customerId' : 'stripe.live.customerId';
        
        // Find user by the appropriate Stripe customer ID field
        const usersSnapshot = await db.collection('users')
          .where(customerField, '==', customerId)
          .limit(1)
          .get();
        
        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          const plan = subscription.status === 'active' ? 'pro' : 'free';
          
          await userDoc.ref.update({
            plan,
            updatedAt: new Date()
          });
        }
        break;
      }
    }
    
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
