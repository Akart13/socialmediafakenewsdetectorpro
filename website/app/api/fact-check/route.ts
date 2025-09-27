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
You are a fact-checking AI. Analyze this social media post and provide a comprehensive fact-check.

Post Text: "${text.replace(/["\\]/g, '\\$&').substring(0, 2000)}"
${images && images.length > 0 ? `Images: ${images.length} image(s) with extracted text` : ''}
Platform: ${platform || 'unknown'}

CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no explanations outside the JSON, no code blocks. Just pure JSON.

Extract 2-4 key factual claims from the post and fact-check each one. Use your knowledge to find credible sources and provide ratings.

Respond with this EXACT JSON structure:
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
      "explanation": "This statistic is accurate according to recent BLS data",
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

Guidelines:
- overallRating: 1-10 (1=completely false, 10=completely true)
- overallConfidence: 0.0-1.0 (0.0=no confidence, 1.0=complete confidence)
- overallAssessment: "True", "Likely True", "Mixed", "Likely False", "False", "Unverifiable"
- For each claim: rating 1-10, confidence 0.0-1.0, explanation with sources
- Sources: real URLs when possible, credible titles, scores 1-10
- keyEvidence: array of key supporting/contradicting evidence
- groundingUsed: true if you used search/grounding, false otherwise

Remember: Respond with ONLY the JSON object, nothing else.
    `;

    const result = await model.generateContent([
      { text: prompt }
    ]);

    const response = result.response;
    let textContent = response.text();

    // Clean up the response text to extract JSON
    textContent = textContent.trim();
    
    // Remove markdown code blocks if present
    if (textContent.startsWith('```json')) {
      textContent = textContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (textContent.startsWith('```')) {
      textContent = textContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    // Try to extract JSON from the response
    let jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      textContent = jsonMatch[0];
    }

    // Parse and validate the response
    let factCheckData;
    try {
      factCheckData = JSON.parse(textContent);
      
      // Validate required fields and set defaults
      if (!factCheckData.overallRating || typeof factCheckData.overallRating !== 'number') {
        factCheckData.overallRating = 5;
      }
      if (!factCheckData.overallConfidence || typeof factCheckData.overallConfidence !== 'number') {
        factCheckData.overallConfidence = 0.5;
      }
      if (!factCheckData.overallAssessment || typeof factCheckData.overallAssessment !== 'string') {
        factCheckData.overallAssessment = "Uncertain";
      }
      if (!factCheckData.overallExplanation || typeof factCheckData.overallExplanation !== 'string') {
        factCheckData.overallExplanation = "Analysis completed";
      }
      if (!Array.isArray(factCheckData.claims)) {
        factCheckData.claims = [];
      }
      
      // Validate and normalize each claim
      factCheckData.claims = factCheckData.claims.map((claim: any) => {
        return {
          claim: typeof claim.claim === 'string' ? claim.claim : "Unable to analyze claim",
          rating: typeof claim.rating === 'number' ? Math.max(1, Math.min(10, claim.rating)) : 5,
          confidence: typeof claim.confidence === 'number' ? Math.max(0, Math.min(1, claim.confidence)) : 0.5,
          explanation: typeof claim.explanation === 'string' ? claim.explanation : "No explanation provided",
          sources: Array.isArray(claim.sources) ? claim.sources.map((source: any) => ({
            url: typeof source.url === 'string' ? source.url : "",
            title: typeof source.title === 'string' ? source.title : "Untitled Source",
            credibilityScore: typeof source.credibilityScore === 'number' ? Math.max(1, Math.min(10, source.credibilityScore)) : 5,
            relevanceScore: typeof source.relevanceScore === 'number' ? Math.max(1, Math.min(10, source.relevanceScore)) : 5,
            summary: typeof source.summary === 'string' ? source.summary : "",
            searchResult: typeof source.searchResult === 'boolean' ? source.searchResult : false
          })) : [],
          keyEvidence: Array.isArray(claim.keyEvidence) ? claim.keyEvidence : [],
          groundingUsed: typeof claim.groundingUsed === 'boolean' ? claim.groundingUsed : false
        };
      });
      
      // Validate searchMetadata
      if (!factCheckData.searchMetadata || typeof factCheckData.searchMetadata !== 'object') {
        factCheckData.searchMetadata = {
          sourcesFound: 0,
          authoritativeSources: 0,
          searchQueries: []
        };
      } else {
        factCheckData.searchMetadata = {
          sourcesFound: typeof factCheckData.searchMetadata.sourcesFound === 'number' ? factCheckData.searchMetadata.sourcesFound : 0,
          authoritativeSources: typeof factCheckData.searchMetadata.authoritativeSources === 'number' ? factCheckData.searchMetadata.authoritativeSources : 0,
          searchQueries: Array.isArray(factCheckData.searchMetadata.searchQueries) ? factCheckData.searchMetadata.searchQueries : []
        };
      }
      
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      console.error('Raw response:', textContent);
      
      // If JSON parsing fails, create a fallback response
      factCheckData = {
        overallRating: 5,
        overallConfidence: 0.5,
        overallAssessment: "Uncertain",
        overallExplanation: "Unable to parse AI response. Please try again.",
        claims: [{
          claim: "Unable to analyze this post",
          rating: 5,
          confidence: 0.5,
          explanation: "Analysis failed due to parsing error. The AI response was not in the expected format.",
          sources: [],
          keyEvidence: [],
          groundingUsed: false
        }],
        searchMetadata: null
      };
    }

    // Normalize the response structure to match what the extension expects
    const normalizedResponse = {
      overallRating: {
        rating: factCheckData.overallRating || 5,
        confidence: factCheckData.overallConfidence || 0.5,
        assessment: factCheckData.overallAssessment || "Uncertain",
        explanation: factCheckData.overallExplanation || "Analysis completed"
      },
      claims: (factCheckData.claims || []).map((claim: any) => ({
        claim: claim.claim || "Unable to analyze claim",
        sources: (claim.sources || []).map((source: any) => ({
          url: source.url || "",
          title: source.title || "",
          credibilityScore: source.credibilityScore || 5,
          relevanceScore: source.relevanceScore || 5,
          summary: source.summary || "",
          searchResult: source.searchResult || false
        })),
        credibilityRating: {
          rating: claim.rating || 5,
          confidence: claim.confidence || 0.5,
          explanation: claim.explanation || "No explanation provided",
          keyEvidence: claim.keyEvidence || [],
          groundingUsed: claim.groundingUsed || false
        }
      })),
      searchMetadata: factCheckData.searchMetadata || null
    };

    return NextResponse.json(normalizedResponse);

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