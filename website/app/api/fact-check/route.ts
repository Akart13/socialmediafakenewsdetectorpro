import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = 'nodejs';

const DAILY_FREE_LIMIT = 5;

async function handler(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    const { text, images, platform } = await req.json();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: "Text content required" }, { status: 400 });
    }

    // Check quota using Firestore transaction
    const docRef = db.collection('users').doc(user.uid);
    
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      const data = snap.exists ? snap.data()! : { plan: "free" };

      // Reset daily window on date change
      const today = new Date().toISOString().slice(0, 10);
      const prev = data.usage?.date || today;
      const count = (prev === today) ? (data.usage?.count || 0) : 0;

      const isPro = data.plan === "pro" && data.subscriptionStatus === "active";
      if (!isPro && count >= DAILY_FREE_LIMIT) {
        throw new Error("QUOTA");
      }

      // Optimistic increment
      transaction.set(docRef, { 
        usage: { 
          date: today, 
          count: isPro ? count : count + 1 
        } 
      }, { merge: true });
    });

    // Call Gemini (server-side key)
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const prompt = `
      Analyze this social media post and provide a comprehensive fact-check using real-time search results.
      
      Post Text: "${text.replace(/["\\]/g, '\\$&').substring(0, 2000)}"
      ${images && images.length > 0 ? `Images: ${images.length} image(s) with extracted text` : ''}
      Platform: ${platform || 'unknown'}
      
      IMPORTANT: Use the search grounding results to verify claims with current, authoritative sources. 
      Cite specific sources from the search results in your analysis.
      
      Please provide a complete fact-check analysis in this JSON format:
      {
        "overallRating": 7,
        "overallConfidence": 0.8,
        "overallAssessment": "Likely True",
        "overallExplanation": "Most claims are well-supported by evidence from authoritative sources",
        "claims": [
          {
            "claim": "The unemployment rate in the US is 3.5%",
            "rating": 8,
            "confidence": 0.9,
            "explanation": "This statistic is accurate according to recent BLS data found in search results",
            "sources": [
              {
                "url": "https://bls.gov/news.release/empsit.nr0.htm",
                "title": "Bureau of Labor Statistics Employment Situation",
                "credibilityScore": 10,
                "relevanceScore": 10,
                "summary": "Official government employment statistics",
                "searchResult": true
              }
            ],
            "keyEvidence": ["Official BLS data", "Recent employment reports"],
            "groundingUsed": true
          }
        ],
        "searchMetadata": {
          "sourcesFound": 3,
          "authoritativeSources": 2,
          "searchQueries": ["unemployment rate 2024", "BLS employment data"]
        }
      }
      
      Focus on:
      1. Extract 2-4 most important factual claims
      2. Use search results to find credible, current sources
      3. Rate each claim's credibility (1-10) based on source quality
      4. Provide clear explanations with source citations
      5. Note when grounding/search results were used
      6. Keep it concise but thorough
    `;

    const result = await model.generateContent([
      { text: prompt }
    ]);

    const response = result.response;
    const textContent = response.text();

    // Parse and validate the response
    let factCheckData;
    try {
      factCheckData = JSON.parse(textContent);
    } catch (parseError) {
      // If JSON parsing fails, create a fallback response
      factCheckData = {
        overallRating: 5,
        overallConfidence: 0.5,
        overallAssessment: "Uncertain",
        overallExplanation: "Unable to parse AI response",
        claims: [{
          claim: "Unable to analyze this post",
          rating: 5,
          confidence: 0.5,
          explanation: "Analysis failed due to parsing error",
          sources: [],
          keyEvidence: [],
          groundingUsed: false
        }],
        searchMetadata: null
      };
    }

    return NextResponse.json(factCheckData);

  } catch (error: any) {
    if (error.message === "NO_AUTH") {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    if (error.message === "QUOTA") {
      return NextResponse.json({ 
        error: "Free quota exceeded", 
        upgradeUrl: "https://fact-checker-website.vercel.app/upgrade" 
      }, { status: 402 });
    }
    
    console.error('Fact check error:', error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withCors(handler);