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

  return clean.slice(0, 3);
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

// Helper function to convert assessment to numeric rating
function getRatingFromAssessment(assessment: string): number {
  switch (assessment) {
    case "True": return 9;
    case "Likely True": return 8;
    case "Mixed": return 6;
    case "Likely False": return 3;
    case "False": return 1;
    case "Unverifiable": return 5;
    default: return 5;
  }
}

// Helper function to get explanation from assessment
function getExplanationFromAssessment(assessment: string): string {
  switch (assessment) {
    case "True": return "All claims are well-supported by evidence from authoritative sources";
    case "Likely True": return "Most claims are well-supported by evidence from reliable sources";
    case "Mixed": return "Some claims are supported while others lack sufficient evidence";
    case "Likely False": return "Most claims are not supported by reliable evidence";
    case "False": return "Claims are contradicted by evidence from authoritative sources";
    case "Unverifiable": return "Insufficient evidence available to verify the claims";
    default: return "Unable to assess the veracity of the claims";
  }
}

// Function to extract individual claims from post text
async function extractClaims(text: string, images?: any[]): Promise<string[]> {
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return ["Unable to extract claims from this post"];
  }

  // Sanitize input to prevent prompt injection
  const sanitizedText = text
    .replace(/[<>]/g, '') // Remove potential HTML/XML tags
    .replace(/[{}]/g, '') // Remove JSON-like structures
    .slice(0, 2000) // Limit length
    .trim();

  if (sanitizedText.length < 5) {
    return ["Unable to extract claims from this post"];
  }

  const prompt = `
  Analyze the following social media post and extract individual factual claims that can be verified.
  
  JSON array only. No markdown.
  Task: From the post below, extract 2-5 ATOMIC, verifiable factual claims.
  - Ignore opinions, jokes, sarcasm, forecasts, and value judgments.
  - Merge duplicates; remove hashtags/handles/links.
  - If no verifiable claims exist, return [].

  Return format: ["claim 1", "claim 2", "claim 3"]

  Post:
  Text: "${sanitizedText}"
    ${images && images.length > 0 ? `Images: ${images.length} image(s) with extracted text` : ''}
  `;

  try {
    const requestBody = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 1024,
        candidateCount: 1,
        stopSequences: ["END_JSON"]
      }
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const responseData = await response.json();
    const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    if (!rawText || rawText.length < 10) {
      return ["Unable to extract claims from this post"];
    }

    // Parse JSON response
    const cleanedText = rawText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
    let claims: string[];
    
    try {
      claims = JSON.parse(cleanedText);
    } catch {
      // If JSON parsing fails, try to extract claims from text
      const lines = cleanedText.split('\n').filter((line: string) => line.trim());
      claims = lines.map((line: string) => line.replace(/^[-*•]\s*/, '').replace(/^"\s*/, '').replace(/"\s*$/, '').trim());
    }

    // Validate and filter claims
    if (!Array.isArray(claims)) {
      return ["Unable to extract claims from this post"];
    }

    return claims.filter(claim => 
      claim && 
      typeof claim === 'string' && 
      claim.trim().length > 0 &&
      claim.trim().length < 500 // Reasonable length limit
    );

  } catch (error) {
    console.error('Claim extraction error:', error);
    return ["Unable to extract claims from this post"];
  }
}

// Function to perform combined fact-checking with claim extraction
async function performCombinedFactCheck(text: string, images?: any[], postDate?: string): Promise<any> {
  // Format the post date for the prompt
  const dateContext = postDate ? `\n\nPost Date: ${new Date(postDate).toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}` : '';

  const prompt = `Return JSON only:
{
  "overallAssessment": "True" | "Likely True" | "Mixed" | "Likely False" | "False" | "Unverifiable",
  "overallConfidence": 0.0-1.0,
  "claims": [
    {
      "claim": "…",
      "rating": 1-10,
      "confidence": 0.0-1.0,
      "explanation": "≤2 sentences",
      "sources": ["url1","url2"]   // ≤2, ONLY from grounded results
    }
  ]
}

Rules:
- Extract 2-4 most important factual claims from the post
- Evaluate each claim individually with ratings and explanations
- Use ONLY URLs present in Google Search grounding results; do NOT fabricate URLs.
- Prefer authoritative sources; if none grounded → set sources=[] and confidence ≤0.4.
- Keep explanations ≤2 sentences; be concise.
- If most claims lack support, set overallAssessment="Unverifiable".
- Focus on factual claims that can be researched and verified, not opinions or subjective statements.
- Consider the post date when evaluating claims - older posts may have outdated information.
- For recent events, prioritize current information and recent sources.

END_JSON after the closing brace.

Post to analyze:
${text}${dateContext}`;

  // Direct REST API call with grounding enabled
  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      maxOutputTokens: 3072,
      candidateCount: 1,
      stopSequences: ["END_JSON"]
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
  
  // Extract raw text from response
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log("Raw text content:", rawText);

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
    body = { 
      overallAssessment: "Unverifiable",
      overallConfidence: 0.5,
      claims: []
    }; 
  }

  console.log("Parsed model JSON:", JSON.stringify(body, null, 2));

  // Process claims and add grounded sources
  const processedClaims = (body.claims || []).map((claim: any) => {
    // Create a map of grounded sources for quick lookup
    const groundedMap = new Map();
    grounded.forEach((g: {url: string, title: string | null}) => {
      groundedMap.set(g.url, g.title);
    });

    // Use the AI's sources if available, otherwise use grounded sources
    const claimSources = claim.sources && claim.sources.length > 0 
      ? claim.sources.map((url: string) => {
          // Try to find the title from grounded sources first
          const groundedTitle = groundedMap.get(url);
          const title = groundedTitle || new URL(url).hostname.replace(/^www\./, '');
          
          return {
            url: url,
            title: title,
            credibilityScore: 7,
            relevanceScore: 8,
            summary: "Fact-checking source",
            searchResult: true
          };
        })
      : grounded.map((g: {url: string, title: string | null}) => ({
          url: g.url,
          title: g.title || new URL(g.url).hostname.replace(/^www\./, ''),
          credibilityScore: 7,
          relevanceScore: 8,
          summary: "Fact-checking source",
          searchResult: true
        }));

    return {
      claim: claim.claim || "Unable to analyze claim",
      credibilityRating: {
        rating: claim.rating || 5,
        confidence: claim.confidence || 0.5,
        explanation: claim.explanation || "No analysis available",
        keyEvidence: claim.keyEvidence || [],
        groundingUsed: grounded.length > 0
      },
      sources: claimSources
    };
  });

  return {
    overallRating: getRatingFromAssessment(body.overallAssessment),
    overallConfidence: body.overallConfidence || 0.5,
    overallAssessment: body.overallAssessment || "Unverifiable",
    overallExplanation: getExplanationFromAssessment(body.overallAssessment),
    claims: processedClaims,
    sources: grounded.map(g => g.url)
  };
}

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
          upgradeUrl: "https://fact-checker-website.vercel.app/billing" 
        }, { status: 402 });
      }
      
      // Increment usage count
      usage.count += 1;
      await db.collection('users').doc(user.uid).set({
        usage: usage
      }, { merge: true });
    }

    const { text, images, postDate } = await req.json();
    
    if (!text || typeof text !== "string" || text.length < 5) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Use the new combined fact-checking approach
    const result = await performCombinedFactCheck(text, images, postDate);

    // Convert to format expected by extension
    const extensionFormat = {
      overallRating: {
        rating: result.overallRating || 5,
        confidence: result.overallConfidence || 0.5,
        assessment: result.overallAssessment || "Unverifiable",
        explanation: result.overallExplanation || "No rationale provided."
      },
      claims: result.claims || [],
      searchMetadata: {
        sourcesFound: result.sources?.length || 0,
        authoritativeSources: result.sources?.length || 0,
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
