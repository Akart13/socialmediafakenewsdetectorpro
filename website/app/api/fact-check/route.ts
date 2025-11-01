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

// Removed unused functions: stripCodeFences, safeJSON, sanitize
// These were old code that might have been causing confusion

/**
 * Extracts grounded sources from Gemini API response metadata.
 * Searches through grounding metadata structures to find URLs and titles of sources used by the model.
 * 
 * @param {any} resp - The Gemini API response object containing grounding metadata
 * @returns {Array<{url: string, title: string | null}>} Array of source objects with URLs and optional titles
 */
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

/**
 * Validates if a string is a valid HTTP or HTTPS URL.
 * Checks for proper protocol, valid URL format, and absence of invalid characters.
 * 
 * @param {string} url - The URL string to validate
 * @returns {boolean} True if the URL is valid, false otherwise
 */
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

/**
 * Converts a text assessment (like "True", "False", etc.) to a numeric rating from 1-10.
 * Used to standardize credibility ratings for display and comparison.
 * 
 * @param {string} assessment - The text assessment value
 * @returns {number} Numeric rating from 1 (False) to 9 (True)
 */
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

/**
 * Generates a human-readable explanation string based on an assessment value.
 * Provides context about what each assessment level means.
 * 
 * @param {string} assessment - The text assessment value
 * @returns {string} Human-readable explanation of the assessment
 */
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

/**
 * Structures and formats the raw fact-check response into a well-organized JSON format.
 * Uses Gemini API to parse and reorganize the response for better readability and consistency.
 * 
 * @param {any} factCheckResult - The raw fact-check result containing rawResponse and groundedSources
 * @returns {Promise<any>} Structured fact-check result with organized ratings, claims, and sources
 */
async function structureFactCheckResponse(factCheckResult: any): Promise<any> {
  const prompt = `
Transform the following fact-check response into a well-structured, organized format that's easier to read and understand.

Please structure the response into a clean, organized JSON with the following structure:
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

Raw fact-check response:
${factCheckResult.rawResponse}

Available grounded sources:
${JSON.stringify(factCheckResult.groundedSources, null, 2)}
`;

  try {
    const requestBody = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        candidateCount: 1,
        temperature: 0.0,
        stopSequences: ["END_JSON"],
        seed: 67,
        responseMimeType: "application/json"
      }
    };

    console.log("=== STRUCTURE FACT CHECK API CALL ===");
    console.log("Request body:", JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Structure Fact Check API error details:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData,
        url: GEMINI_API_URL
      });
      throw new Error(`Gemini structuring API error: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const responseData = await response.json();
    console.log("=== STRUCTURE FACT CHECK API RESPONSE ===");
    console.log("Full response:", JSON.stringify(responseData, null, 2));
    const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    if (!rawText || rawText.length < 10) {
      console.warn('Structuring API returned empty response, using original format');
      return factCheckResult;
    }

    // Clean and parse the structured response with improved error handling
    const cleanedText = rawText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
    let structuredResult;
    
    try {
      structuredResult = JSON.parse(cleanedText);
      
      // Validate the structured result has required fields
      if (!structuredResult || typeof structuredResult !== 'object') {
        throw new Error('Invalid structured result format');
      }
      
    } catch (parseError) {
      console.warn('Failed to parse structured JSON, attempting recovery:', parseError);
      console.warn('Raw structured text:', cleanedText);
      
      // Try to extract JSON more aggressively
      try {
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          structuredResult = JSON.parse(jsonMatch[0]);
          console.log('Recovered structured JSON:', structuredResult);
        } else {
          throw new Error('No JSON found in structured response');
        }
      } catch (recoveryError) {
        console.warn('Structured JSON recovery failed:', recoveryError);
        return factCheckResult;
      }
    }

    // Validate the structured result has required fields
    if (!structuredResult.overallRating || !structuredResult.claims) {
      console.warn('Structured result missing required fields, using original format');
      return factCheckResult;
    }
    
    console.log("=== FINAL STRUCTURED RESULT ===");
    console.log("Structured result:", JSON.stringify(structuredResult, null, 2));

    console.log('Successfully structured fact-check response');
    return structuredResult;

  } catch (error) {
    console.error('Error structuring fact-check response:', error);
    // Return original result if structuring fails
    return factCheckResult;
  }
}

/**
 * Performs fact-checking by analyzing claims using Gemini API with Google Search grounding.
 * Returns raw response text and grounded sources that can be used for verification.
 * 
 * @param {string} text - The original post text (for context)
 * @param {string} claims - The extracted claims to fact-check
 * @param {string} postDate - Optional ISO date string of when the post was published
 * @returns {Promise<any>} Object containing rawResponse text and groundedSources array
 */
async function performCombinedFactCheck(text: string, claims: string, postDate?: string): Promise<any> {
  // Format the post date for the prompt
  const dateContext = postDate ? `\n\nPost Date: ${new Date(postDate).toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}` : '';

        const prompt = `You are a fact-checker on social media. You are given claims.
        For each claim:
        - find 1-3 sources that support or deny the claim. 
        - Provide links that go directly to the sources.
        - Give each source a title and only the title by itself (name of the source such as "CNN", "BBC", "Reuters", etc.)
        - Give each source a credibility score from 1-10 and a relevance score from 1-10.
        - Give each claim a rating from 1-10 and a confidence from 0.0-1.0.
        - Also give a strictly 1 sentence explanation for each claim. 
        Finally, based on the claims and sources:
        - give an overall rating from 1-10, 
        - an overall confidence from 0.0-1.0, 
        - an overall assessment with 1-3 words such as "True", "Likely True", "Mixed", "Likely False", "False", or "Unverifiable"
        - Strictly 1 sentence overall explanation.
        When finished write "END_FACT_CHECK".

        Claims to analyze:
        ${claims}${dateContext}`;

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
      stopSequences: ["END_FACT_CHECK"],
      seed: 67,
    },
    tools: [{
      googleSearch: {}
    }]
  };

  console.log("=== MAIN FACT CHECK API CALL ===");
  console.log("Request body:", JSON.stringify(requestBody, null, 2));
  
  const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('Main Fact Check API error details:', {
      status: response.status,
      statusText: response.statusText,
      errorData: errorData,
      url: GEMINI_API_URL
    });
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData}`);
  }

  const responseData = await response.json();
  console.log("=== MAIN FACT CHECK API RESPONSE ===");
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
  
  // Return the raw response and grounded sources for the structure function to handle
  return {
    rawResponse: rawText,
    groundedSources: grounded
  };
}

/**
 * Main request handler for fact-check API endpoint.
 * Authenticates user, checks quota limits, validates input, performs fact-checking,
 * and returns structured results.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {Promise<NextResponse>} Response containing structured fact-check results or error
 */
async function handler(req: NextRequest) {
  try {
    // Check authentication
    const user = await requireAuth(req);
    
    // Get user data and check quota
    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data()! : { plan: 'free' };
    
    // Check if user is on pro plan
    const isPro = userData.plan === 'pro';
    
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

    const { text, claims, postDate } = await req.json();
    
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
      postDate: postDate
    });

    // Use the new combined fact-checking approach
    const result = await performCombinedFactCheck(sanitizedText, claims,postDate);

    // Structure the response using another Gemini API call
    const structuredResult = await structureFactCheckResponse(result);

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
