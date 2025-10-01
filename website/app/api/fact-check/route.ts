import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

// Force Node.js runtime to prevent truncation
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Direct REST API configuration
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';
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

  const realSources: {url: string, title: string | null}[] = [];

  // Helper function to extract sources from any object structure
  function extractSourcesFromObject(obj: any, path: string = '') {
    if (!obj || typeof obj !== 'object') return;
    
    // Look for common source patterns
    if (obj.url && isValidUrl(obj.url)) {
      realSources.push({
        url: obj.url,
        title: obj.title || obj.name || obj.headline || null
      });
    }
    
    // Look for nested arrays of sources
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => extractSourcesFromObject(item, `${path}[${index}]`));
    } else if (typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        if (key.toLowerCase().includes('source') || 
            key.toLowerCase().includes('result') || 
            key.toLowerCase().includes('url') ||
            key.toLowerCase().includes('web')) {
          extractSourcesFromObject(obj[key], `${path}.${key}`);
        }
      });
    }
  }

  // Extract from all possible grounding metadata structures
  extractSourcesFromObject(gm);

  // Also try specific known structures
  const webSearchQueries = gm.webSearchQueries || gm.web?.searchQueries || [];
  const webSearchResults = gm.webSearchResults || gm.web?.searchResults || [];
  const groundingChunks = gm.groundingChunks || gm.grounding_chunks || [];

  // Extract from web search queries
  if (Array.isArray(webSearchQueries)) {
    webSearchQueries.forEach((query: any) => {
      if (query.webSearchResults && Array.isArray(query.webSearchResults)) {
        query.webSearchResults.forEach((result: any) => {
          if (result.url && isValidUrl(result.url)) {
            realSources.push({
              url: result.url,
              title: result.title || result.name || result.headline || null
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
          title: result.title || result.name || result.headline || null
        });
      }
    });
  }

  // Extract from grounding chunks
  if (Array.isArray(groundingChunks)) {
    groundingChunks.forEach((chunk: any) => {
      const url = chunk.web?.uri || chunk.source?.url || chunk.url || chunk.uri;
      if (url && isValidUrl(url)) {
        realSources.push({
          url: url,
          title: chunk.web?.title || chunk.source?.title || chunk.title || chunk.name || null
        });
      }
    });
  }

  // Remove duplicates
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

  return clean.slice(0, 5); // Increased from 3 to 5 to get more sources
}

function isValidUrl(url: string): boolean {
  try {
    // Check if url is a string and not empty
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return false;
    }
    
    const urlObj = new URL(url);
    const isValidProtocol = urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    
    // Additional validation for common issues
    if (!isValidProtocol) {
      console.warn('Invalid URL protocol:', url);
      return false;
    }
    
    // Check for malformed URLs that might cause issues
    if (url.includes(' ') || url.includes('\n') || url.includes('\t')) {
      console.warn('URL contains invalid characters:', url);
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn('URL validation failed:', url, error);
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
  - Write "END_JSON" at the end of the response.
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
        stopSequences: ["END_JSON"],
        temperature: 0.0,
        seed: 67
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

// Function to structure the fact-check JSON response into a more organized format
async function structureFactCheckResponse(factCheckResult: any): Promise<any> {
  const prompt = `
Transform the following fact-check JSON response into a well-structured, organized format that's easier to read and understand.

Current JSON:
${JSON.stringify(factCheckResult, null, 2)}

Please restructure this into a clean, organized JSON with the following structure:
{
  "overallRating": {
    "rating": number (1-10),
    "confidence": number (0-1),
    "assessment": string,
    "explanation": string
  },
  "claims": [
    {
      "claim": string,
      "credibilityRating": {
        "rating": number (1-10),
        "confidence": number (0-1),
        "explanation": string,
        "keyEvidence": string[],
        "groundingUsed": boolean
      },
      "sources": [
        {
          "url": string,
          "title": string,
          "credibilityScore": number (1-10),
          "relevanceScore": number (1-10),
          "summary": string,
          "searchResult": boolean
        }
      ]
    }
  ],
  "searchMetadata": {
    "sourcesFound": number,
    "authoritativeSources": number,
    "searchQueries": string[]
  }
}

Rules:
- Preserve all original data and values
- Ensure all numbers are properly typed (not strings)
- Clean up any formatting issues
- Make sure all required fields are present
- Keep explanations concise but informative
- Return ONLY the JSON object, no markdown or code fences
- Write "END_JSON" at the end of the response
`;

  try {
    const requestBody = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 4096,
        candidateCount: 1,
        temperature: 0.1,
        stopSequences: ["END_JSON"],
        seed: 67
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
      const errorData = await response.text();
      console.error('Gemini structuring API error details:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData,
        url: GEMINI_API_URL
      });
      throw new Error(`Gemini structuring API error: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const responseData = await response.json();
    const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    if (!rawText || rawText.length < 10) {
      console.warn('Structuring API returned empty response, using original format');
      return factCheckResult;
    }

    // Clean and parse the structured response
    const cleanedText = rawText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
    let structuredResult;
    
    try {
      structuredResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.warn('Failed to parse structured JSON, using original format:', parseError);
      return factCheckResult;
    }

    // Validate the structured result has required fields
    if (!structuredResult.overallRating || !structuredResult.claims) {
      console.warn('Structured result missing required fields, using original format');
      return factCheckResult;
    }

    console.log('Successfully structured fact-check response');
    return structuredResult;

  } catch (error) {
    console.error('Error structuring fact-check response:', error);
    // Return original result if structuring fails
    return factCheckResult;
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

        const prompt = `Return ONLY a raw JSON object. No code fences, no prose. No markdown, no triple backticks, no preface or postscript. Minify JSON. Return <= 1024 tokens. No inline citation markers (e.g., [1], [1,2]) anywhere. Cite only via the sources array.

        {
          "oa": "True" | "Likely True" | "Mixed" | "Likely False" | "False" | "Unverifiable",
          "oc": 0.0-1.0,
          "claims": [
            {
              "c": "claim text",
              "r": 1.0-10.0,
              "conf": 0.0-1.0,
              "exp": "≤12 words",
              "src": ["url1","url2"]
            }
          ]
        }

        Rules:
        - Write "END_JSON" at the end of the response.
        - Max claims: 2-3
        - Max URLs per claim: 3
        - Extract most important factual claims only
        - Use direct publisher URLs only (no shortened or redirect links). Keep to domain + path, no tracking params.
        - Use ONLY URLs present in Google Search grounding results; do NOT fabricate URLs.
        - Do NOT return redirect/tracking links (e.g., vertexaisearch.cloud.google.com, news.google.com, t.co).
        - If a link is a redirect, resolve it and output the final destination URL on the publisher’s domain.
        - Prefer authoritative sources; if none grounded → set src=[] and conf ≤0.4.
        - If most claims lack support, set oa="Unverifiable".
        - Focus on factual claims that can be researched and verified, not opinions or subjective statements.
        - Consider the post date when evaluating claims - older posts may have outdated information.

        Post to analyze:
        ${text}${dateContext}`;

  // Direct REST API call with grounding enabled
  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      maxOutputTokens: 4096,
      candidateCount: 1,
      temperature: 0.0,
      stopSequences: ["END_JSON"],
      seed: 67
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
    console.error('Gemini API error details:', {
      status: response.status,
      statusText: response.statusText,
      errorData: errorData,
      url: GEMINI_API_URL
    });
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
      oa: "Unverifiable",
      oc: 0.5,
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
    let claimSources = [];
    
    if (claim.src && claim.src.length > 0) {
      // Filter for valid URLs only
      const realUrls = claim.src.filter((url: string) => 
        url && 
        typeof url === 'string' && 
        isValidUrl(url)
      );
      
      if (realUrls.length > 0) {
        claimSources = realUrls.map((url: string) => {
          try {
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
          } catch (error) {
            console.warn('Error processing URL:', url, error);
            return null;
          }
        }).filter(Boolean); // Remove null entries
      } else {
        // If no real URLs found, use grounded sources (including redirect URLs as fallback)
        claimSources = grounded
          .filter((g: {url: string, title: string | null}) => isValidUrl(g.url))
          .map((g: {url: string, title: string | null}) => {
            try {
              return {
                url: g.url,
                title: g.title || new URL(g.url).hostname.replace(/^www\./, ''),
                credibilityScore: 7,
                relevanceScore: 8,
                summary: "Fact-checking source",
                searchResult: true
              };
            } catch (error) {
              console.warn('Error processing grounded URL:', g.url, error);
              return null;
            }
          })
          .filter(Boolean); // Remove null entries
      }
    } else {
      // Fallback to grounded sources
      claimSources = grounded
        .filter((g: {url: string, title: string | null}) => isValidUrl(g.url))
        .map((g: {url: string, title: string | null}) => {
          try {
            return {
              url: g.url,
              title: g.title || new URL(g.url).hostname.replace(/^www\./, ''),
              credibilityScore: 7,
              relevanceScore: 8,
              summary: "Fact-checking source",
              searchResult: true
            };
          } catch (error) {
            console.warn('Error processing grounded URL:', g.url, error);
            return null;
          }
        })
        .filter(Boolean); // Remove null entries
    }

    return {
      claim: claim.c || "Unable to analyze claim",
      credibilityRating: {
        rating: claim.r || 5,
        confidence: claim.conf || 0.5,
        explanation: claim.exp || "No analysis available",
        keyEvidence: claim.keyEvidence || [],
        groundingUsed: grounded.length > 0
      },
      sources: claimSources
    };
  });

  return {
    overallRating: getRatingFromAssessment(body.oa),
    overallConfidence: body.oc || 0.5,
    overallAssessment: body.oa || "Unverifiable",
    overallExplanation: getExplanationFromAssessment(body.oa),
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

    // Sanitize input text to prevent URL-related issues
    const sanitizedText = text
      .replace(/[<>]/g, '') // Remove potential HTML/XML tags
      .replace(/[{}]/g, '') // Remove JSON-like structures
      .slice(0, 2000) // Limit length
      .trim();

    if (sanitizedText.length < 5) {
      return NextResponse.json({ error: "Invalid input after sanitization" }, { status: 400 });
    }

    console.log('Processing fact-check request:', {
      textLength: sanitizedText.length,
      hasImages: images && images.length > 0,
      imageCount: images ? images.length : 0,
      postDate: postDate
    });

    // Use the new combined fact-checking approach
    const result = await performCombinedFactCheck(sanitizedText, images, postDate);

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

    // Structure the response using another Gemini API call
    const structuredResult = await structureFactCheckResponse(extensionFormat);

    return NextResponse.json(structuredResult);
  } catch (e: any) {
    console.error("Gemini error:", e?.response?.data || e?.message || e);
    const msg = e?.message || "unknown";
    // If SDK threw a 400, surface it; otherwise 500
    const isBadReq = /400/i.test(msg);
    return NextResponse.json({ error: `Gemini API error: ${msg}` }, { status: isBadReq ? 400 : 500 });
  }
}

export const POST = withCors(handler);
