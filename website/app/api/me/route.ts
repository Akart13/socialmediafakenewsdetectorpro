import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { getCorsHeaders, handleCorsOptions, createCorsResponse } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

export const runtime = 'nodejs';

// Helper function to get today's date in UTC
function todayUtc(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

// Helper function to get reset time
function resetsAtIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const includeLimits = searchParams.get('include') === 'limits';
    
    // Get user document
    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.data() || { 
      plan: "free", 
      usage: { 
        count: 0, 
        date: new Date().toISOString().slice(0, 10)
      } 
    };
    
    const today = todayUtc();
    const plan = data.plan || 'free';
    
    // Basic user info
    const response: any = {
      uid: user.uid,
      email: user.email,
      plan,
      subscriptionStatus: data.subscriptionStatus || "inactive"
    };
    
    // Add limits if requested
    if (includeLimits) {
      // Get today's usage
      const usageDocId = `${user.uid}_${today}`;
      const usageDoc = await db.collection('usage').doc(usageDocId).get();
      const usageData = usageDoc.data();
      const used = usageData?.count || 0;
      
      const limit = plan === 'pro' ? null : parseInt(process.env.FREE_DAILY_LIMIT || '5');
      const remaining = plan === 'pro' ? null : Math.max(0, limit - used);
      
      response.limits = {
        used,
        limit,
        remaining,
        resetsAt: resetsAtIso()
      };
    } else {
      // Calculate remaining for basic response
      const remaining = (plan === "pro" && data.subscriptionStatus === "active")
        ? null
        : Math.max(0, 5 - (data.usage?.date === today ? (data.usage?.count || 0) : 0));
      
      response.remaining = remaining;
    }
    
    return createCorsResponse(response);
  } catch (error) {
    console.error('Error getting user data:', error);
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const { action } = await req.json();
    
    if (action === 'register') {
      // Register user in Firestore
      const userData = {
        uid: user.uid,
        email: user.email,
        plan: 'free',
        subscriptionStatus: 'inactive',
        usage: {
          count: 0,
          date: todayUtc()
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('users').doc(user.uid).set(userData, { merge: true });
      
      return createCorsResponse({ 
        success: true, 
        message: 'User registered successfully',
        user: userData
      });
    }
    
    return createCorsResponse({ error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('Error in user registration:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
