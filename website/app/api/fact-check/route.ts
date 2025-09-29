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

function extractGrounded(resp: any): {url: string, title: string | null}[] {
  const c0 = resp?.candidates?.[0];
  const gm = c0?.groundingMetadata || {};

  console.log("=== EXTRACTING GROUNDED SOURCES ===");
  console.log("Grounding metadata structure:", JSON.stringify(gm, null, 2));

  // Try multiple possible structures for grounding metadata
  const webSearchQueries = gm.webSearchQueries || gm.web?.searchQueries || [];
  const webSearchResults = gm.webSearchResults || gm.web?.searchResults || [];
  const groundingChunks = gm.groundingChunks || gm.grounding_chunks || [];

  console.log("Web search queries:", webSearchQueries.length);
  console.log("Web search results:", webSearchResults.length);
  console.log("Grounding chunks:", groundingChunks.length);

  const realSources: {url: string, title: string | null}[] = [];

  // Extract from web search queries (primary method)
  if (Array.isArray(webSearchQueries)) {
    webSearchQueries.forEach((query: any) => {
      if (query.webSearchResults && Array.isArray(query.webSearchResults)) {
        query.webSearchResults.forEach((result: any) => {
          if (result.url && isValidUrl(result.url)) {
            realSources.push({
              url: result.url,
              title: result.title || null
            });
          }
        });
      }
    });
  }

  // Extract from direct web search results
  if (Array.isArray(webSearchResults)) {
    webSearchResults.forEach((result: any) => {
      if (result.url && isValidUrl(result.url)) {
        realSources.push({
          url: result.url,
          title: result.title || null
        });
      }
    });
  }

  // Extract from grounding chunks
  if (Array.isArray(groundingChunks)) {
    groundingChunks.forEach((chunk: any) => {
      const url = chunk.web?.uri || chunk.source?.url || chunk.url;
      if (url && isValidUrl(url)) {
        realSources.push({
          url: url,
          title: chunk.web?.title || chunk.source?.title || null
        });
      }
    });
  }

  // Remove duplicates (allow redirector URLs)
  const clean: {url: string, title: string | null}[] = [];
  const seen = new Set<string>();
  
  for (const source of realSources) {
    const url = source.url;
    if (!url || !isValidUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    clean.push(source);
  }

  console.log("Extracted sources:", clean.length);
  console.log("Final clean sources:", JSON.stringify(clean, null, 2));

  return clean.slice(0, 5);
}

function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
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
        maxOutputTokens: 2048
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
    
    // Log the raw response for debugging
    console.log("=== GEMINI RAW RESPONSE ===");
    console.log("Full response:", JSON.stringify(responseData, null, 2));
    console.log("Grounding metadata:", JSON.stringify(responseData.candidates?.[0]?.groundingMetadata, null, 2));
    console.log("Web search results:", JSON.stringify(responseData.candidates?.[0]?.groundingMetadata?.web?.searchResults, null, 2));
    console.log("Grounding chunks:", JSON.stringify(responseData.candidates?.[0]?.groundingMetadata?.groundingChunks, null, 2));
    
    // Extract raw text from response
    const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Raw text content:", rawText);
    
    if (!rawText || rawText.length < 20) {
      // Retry once without grounding if first attempt fails
      const retryBody = {
        contents: [{
          role: "user", 
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 2048
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
        const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (retryText && retryText.length >= 20) {
          // Use retry response for parsing
          const textNoFences = retryText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
          let modelJson; 
          try { 
            modelJson = JSON.parse(textNoFences); 
          } catch { 
            modelJson = { rationale: textNoFences }; 
          }
          
          const result = {
            verdict: modelJson.verdict ?? modelJson.rating ?? "Unverifiable",
            rationale: modelJson.rationale ?? modelJson.overallExplanation ?? "No rationale provided.",
            sources: [] // No grounding in retry
          };
          
          return NextResponse.json(result);
        }
      }
    }

    // Build the final result from grounding metadata (not the model's sources)
    const grounded = extractGrounded(responseData);
    
    // Log extracted grounded sources
    console.log("=== EXTRACTED GROUNDED SOURCES ===");
    console.log("Grounded sources:", JSON.stringify(grounded, null, 2));
    console.log("Number of grounded sources:", grounded.length);
    
    // Parse the model text loosely (it may not be strict JSON with tools enabled)
    const raw = (rawText || "").replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
    let body: any; 
    try { 
      body = JSON.parse(raw); 
    } catch { 
      body = { rationale: raw }; 
    }

    console.log("Parsed model JSON:", JSON.stringify(body, null, 2));

    const result = {
      verdict: body?.verdict ?? body?.rating ?? (grounded.length ? "Mixed" : "Unverifiable"),
      rationale: body?.rationale ?? body?.overallExplanation ?? "No rationale provided.",
      sources: grounded.map(g => g.url) // ← use only grounded URLs
    };

    console.log("=== FINAL RESULT ===");
    console.log("Final result:", JSON.stringify(result, null, 2));

    // Convert to format expected by extension
    const extensionFormat = {
      overallRating: {
        rating: result.verdict === "True" ? 9 : 
                result.verdict === "Likely True" ? 8 :
                result.verdict === "Mixed" ? 6 :
                result.verdict === "Likely False" ? 3 :
                result.verdict === "False" ? 1 : 5,
        confidence: 0.8,
        assessment: result.verdict,
        explanation: result.rationale
      },
      claims: [{
        claim: "Overall assessment",
        credibilityRating: {
          rating: result.verdict === "True" ? 9 : 
                  result.verdict === "Likely True" ? 8 :
                  result.verdict === "Mixed" ? 6 :
                  result.verdict === "Likely False" ? 3 :
                  result.verdict === "False" ? 1 : 5,
          confidence: 0.8,
          explanation: result.rationale,
          keyEvidence: [],
          groundingUsed: grounded.length > 0
        },
        sources: grounded.map((g: {url: string, title: string | null}) => ({
          url: g.url,
          title: g.title || "Source",
          credibilityScore: 7,
          relevanceScore: 8,
          summary: "Fact-checking source",
          searchResult: true
        }))
      }],
      searchMetadata: {
        sourcesFound: grounded.length,
        authoritativeSources: grounded.length,
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
