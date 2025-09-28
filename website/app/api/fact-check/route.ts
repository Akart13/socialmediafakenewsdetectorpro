import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

// Force Node.js runtime to prevent truncation
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Direct REST API configuration
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const API_KEY = process.env.GEMINI_API_KEY!;

// Schema removed - using free-form response with grounding

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

function extractGroundedSources(responseData: any): string[] {
  try {
    // Extract grounded sources from the response metadata
    const groundingMetadata = responseData.candidates?.[0]?.groundingMetadata;
    if (!groundingMetadata) return [];

    // Check for web search results
    const webResults = groundingMetadata.web?.searchResults || [];
    const sources = webResults
      .map((result: any) => result.uri || result.url)
      .filter((url: string) => typeof url === "string" && /^https?:\/\//i.test(url))
      .slice(0, 5); // Limit to 5 sources

    return sources;
  } catch (error) {
    console.warn("Failed to extract grounded sources:", error);
    return [];
  }
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

    const prompt = `Fact-check the post below and return your response as valid JSON.

Required JSON format:
{
  "verdict": "True" | "Likely True" | "Mixed" | "Likely False" | "False" | "Unverifiable",
  "rationale": "Your explanation of the fact-check",
  "sources": ["url1", "url2", "url3"]
}

Rules:
- verdict must be one of the exact values above
- rationale should be 2-3 sentences explaining your assessment
- sources should be an array of URLs from your web search (if any)
- If you cannot verify with reliable web sources, set verdict="Unverifiable" and sources=[]
- Return ONLY the JSON object, no other text, no markdown, no backticks

Post to fact-check:
${text}`;

    // Direct REST API call with grounding enabled
    const requestBody = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 1024
      },
      tools: [{
        googleSearch: {}
      }]
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const responseData = await response.json();
    
    // Extract text from response
    let raw = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    if (!raw || raw.length < 20) {
      // Retry once without grounding if first attempt fails
      const retryBody = {
        contents: [{
          role: "user", 
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 1024
        }
      };

      const retryResponse = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(retryBody)
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        raw = retryData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }

    // Clean and parse the response
    const deFenced = stripCodeFences(raw);
    let parsed = safeJSON(deFenced);
    
    // If JSON parsing failed, try to extract JSON from the response
    if (!parsed) {
      const jsonMatch = deFenced.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = safeJSON(jsonMatch[0]);
      }
    }
    
    let normalized = parsed ? sanitize(parsed) : { 
      verdict: "Unverifiable", 
      rationale: deFenced || "Empty response", 
      sources: [] 
    };

    // Extract grounded sources from the response
    const groundedSources = extractGroundedSources(responseData);
    
    // If we have grounded sources, use them; otherwise use the model's sources
    if (groundedSources.length > 0) {
      normalized.sources = groundedSources;
    } else if (normalized.sources.length === 0) {
      // If no grounded sources and no model sources, force Unverifiable
      normalized.verdict = "Unverifiable";
    }

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
