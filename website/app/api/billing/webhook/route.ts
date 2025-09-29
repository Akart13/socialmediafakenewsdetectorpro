import { NextRequest, NextResponse } from 'next/server';
import { getStripe, updateUserSubscriptionStatus, findUserByStripeCustomerId } from '@/lib/stripe';

export const runtime = 'nodejs';

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
        
        if (uid && session.customer) {
          const customerId = session.customer as string;
          await updateUserSubscriptionStatus(uid, 'pro', 'active', customerId);
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status;
        
        // Look up uid by customerId
        const uid = await findUserByStripeCustomerId(customerId);
        if (uid) {
          await updateUserSubscriptionStatus(uid, status === 'active' ? 'pro' : 'free', status);
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
