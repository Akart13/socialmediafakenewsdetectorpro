import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

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

    // Call Gemini API directly via REST (matching extension approach)
    const sanitizedText = text.replace(/["\\]/g, '\\$&').substring(0, 2000);
    
    const prompt = `
    Analyze this social media post and provide a comprehensive fact-check using real-time search results.
    
    Post Text: "${sanitizedText}"
    ${images && images.length > 0 ? `Images: ${images.length} image(s) with extracted text` : ''}
    
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

    // Direct REST API call to Gemini with grounding support (matching extension)
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.8,
            maxOutputTokens: 2048,
          },
          // Enable search grounding for fact-checking (matching extension)
          tools: [{
            googleSearch: {}
          }]
        })
      }
    );

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiResponse.status} ${geminiResponse.statusText}`);
    }

    const geminiData = await geminiResponse.json();
    
    if (!geminiData.candidates || !geminiData.candidates[0] || !geminiData.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }

    // Extract text content and grounding metadata (matching extension approach)
    const candidate = geminiData.candidates[0];
    let responseText = '';
    let groundingMetadata = null;
    
    // Extract text content from the response
    if (candidate.content && candidate.content.parts) {
      responseText = candidate.content.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join(' ');
    }
    
    // Extract grounding metadata if available
    if (candidate.groundingMetadata) {
      groundingMetadata = candidate.groundingMetadata;
    }

    const result = {
      response: {
        text: () => responseText
      },
      groundingMetadata: groundingMetadata
    };

    const response = result.response;
    let textContent = response.text();

    // Clean up the response text to extract JSON (matching extension approach)
    textContent = cleanJsonResponse(textContent);

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

function cleanJsonResponse(response: string): string {
  // Remove markdown code blocks and clean up the response
  let cleaned = response.trim();
  
  // Remove ```json and ``` markers
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/```\s*$/i, '');
  cleaned = cleaned.replace(/^```\s*/i, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // If the response doesn't start with [ or {, try to find the JSON part
  if (!cleaned.startsWith('[') && !cleaned.startsWith('{')) {
    const jsonMatch = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      cleaned = jsonMatch[1];
    }
  }
  
  // Additional cleaning for common JSON issues
  try {
    // Try to parse and re-stringify to validate and clean
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed);
  } catch (error) {
    // If parsing fails, try to fix common issues
    console.warn('JSON parsing failed, attempting to fix:', error);
    
    // Fix common issues:
    // 1. Unescaped quotes in strings
    cleaned = cleaned.replace(/([^\\])"([^"]*)"([^,}\]]*)/g, (match, before, content, after) => {
      // Only fix if it looks like an unescaped quote in a string value
      if (before.match(/[:\s]/) && after.match(/[,}\]]/)) {
        const escapedContent = content.replace(/"/g, '\\"');
        return `${before}"${escapedContent}"${after}`;
      }
      return match;
    });
    
    // 2. Remove trailing commas
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    
    // 3. Fix missing quotes around keys
    cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    // 4. Remove any non-JSON content that might be mixed in
    const lines = cleaned.split('\n');
    const jsonLines = [];
    let inJson = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        inJson = true;
      }
      if (inJson) {
        jsonLines.push(line);
        if (trimmed.endsWith(']') || trimmed.endsWith('}')) {
          break;
        }
      }
    }
    
    if (jsonLines.length > 0) {
      cleaned = jsonLines.join('\n');
    }
    
    return cleaned;
  }
}

export const POST = withCors(handler);