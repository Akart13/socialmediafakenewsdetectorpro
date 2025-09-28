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
     
     CRITICAL: You have access to real-time search results through grounding. Use ONLY the actual URLs, titles, and content from the search results provided by the grounding system. Do NOT generate or make up URLs, titles, or content. Only reference sources that are actually found in the search results.
     
     When you find sources in the search results, use their EXACT URLs and titles. Do not modify or generate fake URLs.
     
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
               "url": "ACTUAL_URL_FROM_SEARCH_RESULTS",
               "title": "ACTUAL_TITLE_FROM_SEARCH_RESULTS",
               "credibilityScore": 10,
               "relevanceScore": 10,
               "summary": "Summary based on actual search result content",
               "searchResult": true
             }
           ],
           "keyEvidence": ["Evidence from actual search results"],
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
     2. Use ONLY actual URLs and titles from search results
     3. Rate each claim's credibility (1-10) based on source quality
     4. Provide clear explanations with source citations from real search results
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

     // Extract actual URLs from grounding metadata
     const actualUrls = extractUrlsFromGrounding(groundingMetadata);
     console.log('Actual URLs from grounding:', actualUrls);

     const result = {
       response: {
         text: () => responseText
       },
       groundingMetadata: groundingMetadata,
       actualUrls: actualUrls
     };

    const response = result.response;
    let textContent = response.text();

    // Clean up the response text to extract JSON (matching extension approach)
    textContent = cleanJsonResponse(textContent);

     // Parse and validate the response
     let factCheckData;
     try {
       factCheckData = JSON.parse(textContent);
       
       // Replace any fake URLs with actual URLs from grounding
       if (result.actualUrls && result.actualUrls.length > 0) {
         factCheckData = replaceFakeUrlsWithRealOnes(factCheckData, result.actualUrls);
       }
       
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
  
  // Try to parse first to see if it's already valid
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed);
  } catch (error) {
    console.warn('JSON parsing failed, attempting to fix:', error);
    
    // Check if the response looks like it was truncated
    if (cleaned.length > 1000 && !cleaned.endsWith('}') && !cleaned.endsWith(']')) {
      console.warn('Response appears to be truncated, attempting to complete it');
      
      // Try to find the last complete object/array and close it
      let truncated = cleaned;
      
      // Count unclosed brackets and braces
      const openBrackets = (truncated.match(/\[/g) || []).length;
      const closeBrackets = (truncated.match(/\]/g) || []).length;
      const openBraces = (truncated.match(/\{/g) || []).length;
      const closeBraces = (truncated.match(/\}/g) || []).length;
      
      // Add missing closing brackets/braces
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        truncated += ']';
      }
      for (let i = 0; i < openBraces - closeBraces; i++) {
        truncated += '}';
      }
      
      // Try to parse the completed version
      try {
        const completedParsed = JSON.parse(truncated);
        console.log('Successfully completed truncated JSON');
        return JSON.stringify(completedParsed);
      } catch (completionError) {
        console.warn('Failed to complete truncated JSON:', completionError);
      }
    }
    
    // More conservative approach - only fix obvious issues
    let fixed = cleaned;
    
    // 1. Remove trailing commas before closing brackets/braces
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // 2. Fix missing quotes around object keys (but be more careful)
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    // 3. Try to find the complete JSON object/array by counting brackets
    const lines = fixed.split('\n');
    const jsonLines = [];
    let bracketCount = 0;
    let braceCount = 0;
    let inJson = false;
    let foundStart = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Start counting when we find the opening bracket/brace
      if (!foundStart && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
        foundStart = true;
        inJson = true;
      }
      
      if (inJson) {
        jsonLines.push(line);
        
        // Count brackets and braces
        for (const char of line) {
          if (char === '[') bracketCount++;
          if (char === ']') bracketCount--;
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        
        // Stop when we have balanced brackets and braces
        if (foundStart && bracketCount === 0 && braceCount === 0) {
          break;
        }
      }
    }
    
    if (jsonLines.length > 0) {
      fixed = jsonLines.join('\n');
    }
    
    // Try parsing the fixed version
    try {
      const parsed = JSON.parse(fixed);
      return JSON.stringify(parsed);
    } catch (secondError) {
      console.error('JSON cleaning failed completely:', secondError);
      console.error('Original response length:', response.length);
      console.error('Cleaned response length:', fixed.length);
      console.error('First 500 chars of cleaned:', fixed.substring(0, 500));
      console.error('Last 200 chars of cleaned:', fixed.substring(Math.max(0, fixed.length - 200)));
      
      // Try to salvage what we can from the partial JSON
      try {
        // Look for the last complete claim or object
        const lastCompleteBrace = fixed.lastIndexOf('}');
        const lastCompleteBracket = fixed.lastIndexOf(']');
        const lastComplete = Math.max(lastCompleteBrace, lastCompleteBracket);
        
        if (lastComplete > 0) {
          // Try to find a complete structure up to the last complete element
          let salvaged = fixed.substring(0, lastComplete + 1);
          
          // If we're in the middle of an array, try to close it
          if (lastCompleteBracket > lastCompleteBrace) {
            // We're in an array, try to close it properly
            const openBrackets = (salvaged.match(/\[/g) || []).length;
            const closeBrackets = (salvaged.match(/\]/g) || []).length;
            const openBraces = (salvaged.match(/\{/g) || []).length;
            const closeBraces = (salvaged.match(/\}/g) || []).length;
            
            // Add missing closing brackets/braces
            for (let i = 0; i < openBrackets - closeBrackets; i++) {
              salvaged += ']';
            }
            for (let i = 0; i < openBraces - closeBraces; i++) {
              salvaged += '}';
            }
          }
          
          // Try to parse the salvaged JSON
          const salvagedParsed = JSON.parse(salvaged);
          console.log('Successfully salvaged partial JSON');
          return JSON.stringify(salvagedParsed);
        }
      } catch (salvageError) {
        console.error('Salvage attempt failed:', salvageError);
      }
      
      // Return a fallback JSON structure
      return JSON.stringify({
        overallRating: 5,
        overallConfidence: 0.1,
        overallAssessment: "Unable to parse response",
        overallExplanation: "The AI response could not be parsed as valid JSON",
        claims: [{
          claim: "Response parsing failed",
          rating: 1,
          confidence: 0.1,
          explanation: "The AI response was malformed and could not be processed",
          sources: [],
          keyEvidence: [],
          groundingUsed: false
        }],
        searchMetadata: null
      });
    }
  }
}

// Helper function to extract URLs from grounding metadata
function extractUrlsFromGrounding(groundingMetadata: any): Array<{url: string, title: string, snippet: string}> {
  const urls: Array<{url: string, title: string, snippet: string}> = [];
  
  if (!groundingMetadata || !groundingMetadata.groundingChunks) {
    return urls;
  }
  
  try {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web && chunk.web.uri) {
        urls.push({
          url: chunk.web.uri,
          title: chunk.web.title || 'Untitled',
          snippet: chunk.web.snippet || ''
        });
      }
    }
  } catch (error) {
    console.error('Error extracting URLs from grounding:', error);
  }
  
  return urls;
}

// Helper function to replace fake URLs with real ones from grounding
function replaceFakeUrlsWithRealOnes(factCheckData: any, actualUrls: Array<{url: string, title: string, snippet: string}>): any {
  if (!factCheckData.claims || !Array.isArray(factCheckData.claims)) {
    return factCheckData;
  }
  
  // Create a mapping of titles to URLs for better matching
  const urlMap = new Map<string, {url: string, title: string, snippet: string}>();
  actualUrls.forEach(item => {
    urlMap.set(item.title.toLowerCase(), item);
    urlMap.set(item.url, item);
  });
  
  factCheckData.claims.forEach((claim: any) => {
    if (claim.sources && Array.isArray(claim.sources)) {
      claim.sources.forEach((source: any) => {
        // Check if this looks like a fake URL or if we can find a better match
        if (source.url && (source.url.includes('bls.gov') || source.url.includes('example.com') || 
            source.url === 'ACTUAL_URL_FROM_SEARCH_RESULTS' || 
            !source.url.startsWith('http'))) {
          
          // Try to find a matching real URL
          const matchingUrl = findBestMatchingUrl(source, actualUrls);
          if (matchingUrl) {
            source.url = matchingUrl.url;
            source.title = matchingUrl.title;
            source.summary = matchingUrl.snippet || source.summary;
            source.searchResult = true;
          }
        }
      });
    }
  });
  
  return factCheckData;
}

// Helper function to find the best matching URL based on title or content
function findBestMatchingUrl(source: any, actualUrls: Array<{url: string, title: string, snippet: string}>): {url: string, title: string, snippet: string} | null {
  if (!source.title) return actualUrls[0] || null;
  
  const sourceTitle = source.title.toLowerCase();
  
  // First try exact title match
  for (const url of actualUrls) {
    if (url.title.toLowerCase() === sourceTitle) {
      return url;
    }
  }
  
  // Then try partial title match
  for (const url of actualUrls) {
    if (url.title.toLowerCase().includes(sourceTitle) || sourceTitle.includes(url.title.toLowerCase())) {
      return url;
    }
  }
  
  // Finally, try keyword matching
  const sourceKeywords = sourceTitle.split(' ').filter((word: string) => word.length > 3);
  for (const url of actualUrls) {
    const urlKeywords = url.title.toLowerCase().split(' ').filter((word: string) => word.length > 3);
    const commonKeywords = sourceKeywords.filter((keyword: string) => 
      urlKeywords.some((urlKeyword: string) => urlKeyword.includes(keyword) || keyword.includes(urlKeyword))
    );
    
    if (commonKeywords.length > 0) {
      return url;
    }
  }
  
  return actualUrls[0] || null;
}

export const POST = withCors(handler);