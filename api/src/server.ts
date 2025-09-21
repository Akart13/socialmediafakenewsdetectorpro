import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Stripe from 'stripe';
import { verifyToken, JWTPayload, signToken } from './jwt';
import jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    // For production deployments (e.g., Vercel, Render)
    // Firebase Admin SDK will auto-initialize with environment variables
    initializeApp();
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    // Continue without Firebase for now - will fail gracefully on Firebase calls
  }
}

let db: any;
let admin: any;
try {
  db = getFirestore();
  admin = { auth: getAuth() };
  console.log('Firestore initialized successfully');
} catch (error) {
  console.error('Firestore initialization error:', error);
}

// Initialize Stripe
let stripe: Stripe;
try {
  if (!process.env.STRIPE_SECRET) {
    throw new Error('STRIPE_SECRET environment variable is required');
  }
  stripe = new Stripe(process.env.STRIPE_SECRET, {
    apiVersion: '2023-10-16'
  });
  console.log('Stripe initialized successfully');
} catch (error) {
  console.error('Stripe initialization error:', error);
  throw error;
}

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'https://fact-checker-website-j4gfvisri-amit-s-projects-3f01818e.vercel.app',
  ...(process.env.CORS_ALLOW?.split(',').map(origin => origin.trim()) || [])
];

app.use(cors({
  origin: allowedOrigins,
  credentials: false
}));

app.use(express.json());

// Raw body parser for Stripe webhooks
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Auth middleware
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);
  try {
    const payload = verifyToken(token);
    (req as any).uid = payload.uid;
    (req as any).email = payload.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Helper functions
function todayUtc(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function resetsAtIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

// Stub fact-check function (replace with actual AI implementation)
async function factCheck(text: string): Promise<{ result: string; credibility: number; sources: string[] }> {
  // This is a placeholder - replace with actual AI fact-checking logic
  await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing time
  
  return {
    result: `This is a mock fact-check result for the text: "${text.substring(0, 100)}...". In a real implementation, this would use AI to analyze the content and provide factual accuracy assessment.`,
    credibility: 0.75,
    sources: [
      'Reuters Fact Check',
      'AP News Verification',
      'PolitiFact Analysis'
    ]
  };
}

// Routes

// GET /api/me/limits
app.get('/api/me/limits', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const today = todayUtc();
    
    // Get user document
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = userData?.plan || 'free';
    
    // Get today's usage
    const usageDocId = `${uid}_${today}`;
    const usageDoc = await db.collection('usage').doc(usageDocId).get();
    const usageData = usageDoc.data();
    const used = usageData?.count || 0;
    
    const limit = plan === 'pro' ? null : parseInt(process.env.FREE_DAILY_LIMIT || '5');
    
    res.json({
      plan,
      used,
      limit,
      resetsAt: resetsAtIso()
    });
  } catch (error) {
    console.error('Error getting limits:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fact-check
app.post('/api/fact-check', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    const today = todayUtc();
    const usageDocId = `${uid}_${today}`;
    
    // Get user plan
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = userData?.plan || 'free';
    
    // Check limits for free users
    if (plan === 'free') {
      const usageDoc = await db.collection('usage').doc(usageDocId).get();
      const usageData = usageDoc.data();
      const currentCount = usageData?.count || 0;
      const limit = parseInt(process.env.FREE_DAILY_LIMIT || '5');
      
      if (currentCount >= limit) {
        return res.status(402).json({
          error: 'quota_exceeded',
          used: currentCount,
          limit,
          resetsAt: resetsAtIso()
        });
      }
    }
    
    // Run fact check
    const result = await factCheck(text);
    
    // Increment usage counter for free users
    if (plan === 'free') {
      await db.collection('usage').doc(usageDocId).set({
        uid,
        day: today,
        count: (await db.collection('usage').doc(usageDocId).get()).data()?.count + 1 || 1,
        updatedAt: new Date()
      }, { merge: true });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error during fact check:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ext/auth - Extension authentication endpoint
app.post('/api/ext/auth', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const idToken = authHeader.substring(7);
    
    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email || '';

    // Get the state from request body
    const state = req.body.state;

    if (!state) {
      return res.status(400).json({ error: 'Missing state parameter' });
    }

    // Create app JWT token
    const appToken = jwt.sign(
      { uid, email },
      process.env.APP_JWT_SECRET!,
      { expiresIn: '24h' }
    );

    res.json({ 
      appToken,
      uid,
      email 
    });
    
  } catch (error) {
    console.error('Extension auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// POST /api/billing/create-checkout-session
app.post('/api/billing/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const email = (req as any).email;
    
    // Get or create Stripe customer
    let userDoc = await db.collection('users').doc(uid).get();
    let userData = userDoc.data();
    let stripeCustomerId = userData?.stripeCustomerId;
    
    if (!stripeCustomerId) {
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
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/webhook
app.post('/api/billing/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  let event: Stripe.Event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return res.status(400).send('Webhook signature verification failed');
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.metadata?.uid;
        
        if (uid) {
          await db.collection('users').doc(uid).set({
            plan: 'pro',
            updatedAt: new Date()
          }, { merge: true });
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        // Find user by Stripe customer ID
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get();
        
        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          const plan = subscription.status === 'active' ? 'pro' : 'free';
          
          await userDoc.ref.set({
            plan,
            updatedAt: new Date()
          }, { merge: true });
        }
        break;
      }
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
