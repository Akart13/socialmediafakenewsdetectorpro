import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

export const runtime = 'nodejs';

async function handler(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const doc = await db.collection('users').doc(user.uid).get();
    const data = doc.data() || { 
      plan: "free", 
      usage: { 
        count: 0, 
        date: new Date().toISOString().slice(0, 10)
      } 
    };
    
    const today = new Date().toISOString().slice(0, 10);
    const remaining = (data.plan === "pro" && data.subscriptionStatus === "active")
      ? null
      : Math.max(0, 5 - (data.usage?.date === today ? (data.usage?.count || 0) : 0));
    
    return NextResponse.json({ 
      uid: user.uid, 
      email: user.email, 
      plan: data.plan, 
      subscriptionStatus: data.subscriptionStatus || "inactive",
      remaining 
    });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export const GET = withCors(handler);
