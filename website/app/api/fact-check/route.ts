import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Force Node.js runtime to prevent truncation
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const schema = {
  type: "object" as const,
  properties: {
    verdict: { type: "string" as const, enum: ["True","Likely True","Mixed","Likely False","False","Unverifiable"] },
    rationale: { type: "string" as const },
    sources: { type: "array" as const, items: { type: "string" as const } }
  },
  required: ["verdict","rationale","sources"] as const
};

function stripCodeFences(s: string) {
  return s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
}

function safeJSON(s: string) { 
  try { 
    return JSON.parse(s); 
  } catch { 
    return null; 
  } 
}

function sanitize(out: any) {
  const verdict = out?.verdict ?? out?.rating ?? "Unclear";
  const rationale = out?.rationale ?? out?.overallExplanation ?? "No rationale provided.";
  const sources = Array.isArray(out?.sources) ? out.sources : [];
  const clean = sources
    .map((x: any) => typeof x === "string" ? x : x?.url)
    .filter((u: string) => typeof u === "string" && /^https?:\/\//i.test(u))
    .slice(0, 5);
  return { verdict, rationale, sources: clean };
}

const DAILY_FREE_LIMIT = 5;

async function handler(req: NextRequest) {
  try {
    // Check authentication
    const user = await requireAuth(req);
    
    // Get user data and check quota
    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data()! : { plan: 'free' };
    
    // Check if user is on pro plan
    const isPro = userData.plan === 'pro' && userData.subscriptionStatus === 'active';
    
    // Check daily quota for free users
    if (!isPro) {
      const today = new Date().toISOString().slice(0, 10);
      const usage = userData.usage || { date: today, count: 0 };
      
      // Reset count if it's a new day
      if (usage.date !== today) {
        usage.date = today;
        usage.count = 0;
      }
      
      // Check if quota exceeded
      if (usage.count >= DAILY_FREE_LIMIT) {
        return NextResponse.json({ 
          error: "Free quota exceeded", 
          upgradeUrl: "https://fact-checker-website.vercel.app/upgrade" 
        }, { status: 402 });
      }
      
      // Increment usage count
      usage.count += 1;
      await db.collection('users').doc(user.uid).set({
        usage: usage
      }, { merge: true });
    }

    const { text } = await req.json();
    
    if (!text || typeof text !== "string" || text.length < 5) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const prompt = `Fact-check the post below.
Return ONLY JSON with fields: verdict, rationale, sources (array of URLs).
No markdown, no backticks. If nothing can be verified with reliable web sources, set verdict="Unverifiable" and sources=[].

Post:
${text}`;

    const resp = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 1024
      }
      // (Add tools/search grounding later once the basics are stable)
    });

    let raw = resp.response.text();       // <- always use text()
    if (!raw || raw.length < 20) {
      // Retry once without schema, then fall back
      const r2 = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });
      raw = r2.response.text() || "";
    }

    const deFenced = stripCodeFences(raw);
    const parsed = safeJSON(deFenced);
    let normalized = parsed ? sanitize(parsed) : { verdict: "Unverifiable", rationale: deFenced || "Empty response", sources: [] };

    // Convert to format expected by extension
    const extensionFormat = {
      overallRating: {
        rating: normalized.verdict === "True" ? 9 : 
                normalized.verdict === "Likely True" ? 8 :
                normalized.verdict === "Mixed" ? 6 :
                normalized.verdict === "Likely False" ? 3 :
                normalized.verdict === "False" ? 1 : 5,
        confidence: 0.8,
        assessment: normalized.verdict,
        explanation: normalized.rationale
      },
      claims: [{
        claim: "Overall assessment",
        credibilityRating: {
          rating: normalized.verdict === "True" ? 9 : 
                  normalized.verdict === "Likely True" ? 8 :
                  normalized.verdict === "Mixed" ? 6 :
                  normalized.verdict === "Likely False" ? 3 :
                  normalized.verdict === "False" ? 1 : 5,
          confidence: 0.8,
          explanation: normalized.rationale,
          keyEvidence: [],
          groundingUsed: false
        },
        sources: normalized.sources.map((url: string) => ({
          url: url,
          title: "Source",
          credibilityScore: 7,
          relevanceScore: 8,
          summary: "Fact-checking source",
          searchResult: true
        }))
      }],
      searchMetadata: {
        sourcesFound: normalized.sources.length,
        authoritativeSources: normalized.sources.length,
        searchQueries: []
      }
    };

    return NextResponse.json(extensionFormat);
  } catch (e: any) {
    console.error("Gemini error:", e?.response?.data || e?.message || e);
    const msg = e?.message || "unknown";
    // If SDK threw a 400, surface it; otherwise 500
    const isBadReq = /400/i.test(msg);
    return NextResponse.json({ error: `Gemini API error: ${msg}` }, { status: isBadReq ? 400 : 500 });
  }
}

export const POST = withCors(handler);
