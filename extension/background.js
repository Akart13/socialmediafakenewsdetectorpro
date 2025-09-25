const geminiAPIKey = 'AIzaSyDaU5J4YTH70BihYb8QbGHjiK6negpX2os';

// Background script for handling API calls and storage
chrome.runtime.onInstalled.addListener(() => {
  console.log('Social Media Fact Checker extension installed');
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'factCheck') {
    handleFactCheck(request.data, sendResponse);
    return true; // Keep message channel open for async response
  } else if (request.action === 'ping') {
    // Respond to ping to verify extension context is valid
    sendResponse({ status: 'ok' });
    return false;
  } else if (request.action === 'checkAuth') {
    checkAuthentication(sendResponse);
    return true;
  } else if (request.action === 'getUsage') {
    getUsageStats(sendResponse);
    return true;
  }
});

async function handleFactCheck(data, sendResponse) {
  try {
    // Check authentication first
    const authResult = await checkAuthenticationSync();
    if (!authResult.authenticated) {
      sendResponse({
        success: false,
        error: 'Please sign in to use the fact checker',
        requiresAuth: true
      });
      return;
    }

    // Check usage limits for free users
    const usageResult = await getUsageStatsSync();
    if (authResult.plan === 'free' && usageResult.todayChecks >= 5) {
      sendResponse({
        success: false,
        error: 'Daily limit reached. Upgrade to Pro for unlimited checks.',
        limitReached: true,
        todayChecks: usageResult.todayChecks,
        maxChecks: 5
      });
      return;
    }

    // Validate input data
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided');
    }
    
    const { text, images, platform } = data;
    
    // Validate required fields
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('No text content found to analyze');
    }
    
    // Update usage statistics
    await updateStats();
    
    // OPTIMIZATION: Single combined analysis instead of per-claim analysis
    const factCheckResults = await performCombinedFactCheck(text, images || []);
    
    // The combined analysis already includes overall rating
    sendResponse({
      success: true,
      results: {
        claims: factCheckResults.claims,
        overallRating: factCheckResults.overallRating
      },
      usage: await getUsageStatsSync()
    });
    
  } catch (error) {
    console.error('Fact check error:', error);
    sendResponse({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
}

// OPTIMIZED: Single API call for complete fact-checking
async function performCombinedFactCheck(text, images) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  
  // Sanitize text
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
  
  try {
    const response = await callGeminiAPI(prompt, apiKey);
    const result = JSON.parse(cleanJsonResponse(response.text));
    
    // Extract grounding metadata for additional context
    const groundingMetadata = response.groundingMetadata;
    console.log('Grounding metadata:', groundingMetadata);
    
    // Validate and clean result
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid response format');
    }
    
    // Ensure we have the expected structure
    const factCheckResults = {
      overallRating: {
        rating: Math.max(1, Math.min(10, Math.round(result.overallRating || 5))),
        confidence: Math.max(0, Math.min(1, result.overallConfidence || 0.1)),
        assessment: result.overallAssessment || "Uncertain",
        explanation: (result.overallExplanation || 'Analysis completed').substring(0, 500)
      },
      groundingMetadata: groundingMetadata,
      searchMetadata: result.searchMetadata || null,
      claims: Array.isArray(result.claims) ? result.claims.map(claim => ({
        claim: (claim.claim || '').substring(0, 500),
        sources: Array.isArray(claim.sources) ? claim.sources.slice(0, 3).map(source => ({
          url: (source.url || '').substring(0, 500),
          title: (source.title || '').substring(0, 200),
          credibilityScore: Math.max(1, Math.min(10, Math.round(source.credibilityScore || 5))),
          relevanceScore: Math.max(1, Math.min(10, Math.round(source.relevanceScore || 5))),
          summary: (source.summary || '').substring(0, 300),
          searchResult: source.searchResult || false
        })) : [],
        credibilityRating: {
          rating: Math.max(1, Math.min(10, Math.round(claim.rating || 5))),
          confidence: Math.max(0, Math.min(1, claim.confidence || 0.1)),
          explanation: (claim.explanation || 'No explanation provided').substring(0, 500),
          keyEvidence: Array.isArray(claim.keyEvidence) ? claim.keyEvidence.slice(0, 3) : [],
          groundingUsed: claim.groundingUsed || false
        }
      })) : []
    };
    
    return factCheckResults;
  } catch (error) {
    console.error('Failed to parse combined fact-check JSON:', error);
    // Return fallback response
    return {
      overallRating: {
        rating: 5,
        confidence: 0.1,
        assessment: "Unable to analyze",
        explanation: "Error occurred during analysis"
      },
      groundingMetadata: null,
      searchMetadata: null,
      claims: [{
        claim: "Unable to extract claims from this post",
        sources: [],
        credibilityRating: {
          rating: 5,
          confidence: 0.1,
          explanation: "Analysis failed",
          keyEvidence: [],
          groundingUsed: false
        }
      }]
    };
  }
}

async function extractClaims(text, images) {
  // Validate inputs
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text input');
  }
  
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  
  // Sanitize text to prevent prompt injection
  const sanitizedText = text.replace(/["\\]/g, '\\$&').substring(0, 2000); // Limit length
  
  const prompt = `
    Analyze the following social media post and extract individual factual claims that can be verified.
    
    Text: "${sanitizedText}"
    ${images && images.length > 0 ? `Images: ${images.length} image(s) with extracted text` : ''}
    
    Return a JSON array of claims, where each claim is a clear, verifiable statement.
    Focus on factual claims that can be researched and verified, not opinions or subjective statements.
    
    Example format:
    [
      "The unemployment rate in the US is 3.5%",
      "Climate change is caused by human activities",
      "The COVID-19 vaccine has 95% efficacy"
    ]
  `;
  
  try {
    const response = await callGeminiAPI(prompt, apiKey);
    const claims = JSON.parse(cleanJsonResponse(response.text));
    
    // Validate response
    if (!Array.isArray(claims)) {
      throw new Error('Invalid response format');
    }
    
    // Filter and validate claims
    return claims.filter(claim => 
      claim && 
      typeof claim === 'string' && 
      claim.trim().length > 0 &&
      claim.trim().length < 500 // Reasonable length limit
    );
  } catch (error) {
    console.error('Failed to parse claims JSON:', error);
    // Return a fallback response
    return ["Unable to extract claims from this post"];
  }
}

async function findRelevantSources(claim) {
  // Validate input
  if (!claim || typeof claim !== 'string' || claim.trim().length === 0) {
    throw new Error('Invalid claim provided');
  }
  
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  
  // Sanitize claim to prevent prompt injection
  const sanitizedClaim = claim.replace(/["\\]/g, '\\$&').substring(0, 1000);
  
  const prompt = `
    Find relevant, credible sources to verify this claim: "${sanitizedClaim}"
    
    Use grounding to search for authoritative sources including:
    - Government websites (.gov)
    - Academic institutions (.edu)
    - Reputable news organizations
    - Scientific journals
    - International organizations
    
    For each source, provide:
    - URL
    - Title
    - Credibility score (1-10)
    - Relevance score (1-10)
    - Brief summary of how it relates to the claim
    
    Return as JSON array with this structure:
    [
      {
        "url": "https://example.com",
        "title": "Source Title",
        "credibilityScore": 9,
        "relevanceScore": 8,
        "summary": "Brief description of relevance"
      }
    ]
  `;
  
  try {
    const response = await callGeminiAPI(prompt, apiKey);
    const sources = JSON.parse(cleanJsonResponse(response.text));
    
    // Validate response
    if (!Array.isArray(sources)) {
      throw new Error('Invalid response format');
    }
    
    // Validate and clean sources
    return sources.filter(source => {
      return source && 
             typeof source === 'object' &&
             source.url && 
             source.title &&
             typeof source.credibilityScore === 'number' &&
             typeof source.relevanceScore === 'number' &&
             source.credibilityScore >= 1 && source.credibilityScore <= 10 &&
             source.relevanceScore >= 1 && source.relevanceScore <= 10;
    }).map(source => ({
      url: source.url.substring(0, 500), // Limit URL length
      title: source.title.substring(0, 200), // Limit title length
      credibilityScore: Math.round(source.credibilityScore),
      relevanceScore: Math.round(source.relevanceScore),
      summary: (source.summary || '').substring(0, 300) // Limit summary length
    }));
  } catch (error) {
    console.error('Failed to parse sources JSON:', error);
    // Return a fallback response
    return [{
      url: "https://example.com",
      title: "Unable to find sources",
      credibilityScore: 1,
      relevanceScore: 1,
      summary: "Error occurred while searching for sources"
    }];
  }
}

async function assessClaimCredibility(claim, sources) {
  // Validate inputs
  if (!claim || typeof claim !== 'string' || claim.trim().length === 0) {
    throw new Error('Invalid claim provided');
  }
  
  if (!Array.isArray(sources)) {
    sources = [];
  }
  
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Google Gemini API key not configured');
  }
  
  // Sanitize claim
  const sanitizedClaim = claim.replace(/["\\]/g, '\\$&').substring(0, 1000);
  
  // Build sources text safely
  const sourcesText = sources.map(s => {
    if (!s || typeof s !== 'object') return '';
    return `Source: ${(s.title || '').substring(0, 100)}\nURL: ${(s.url || '').substring(0, 100)}\nCredibility: ${s.credibilityScore || 1}/10\nRelevance: ${s.relevanceScore || 1}/10\nSummary: ${(s.summary || '').substring(0, 200)}`;
  }).filter(text => text.length > 0).join('\n\n');
  
  const prompt = `
    Based on the following sources, assess the credibility of this claim: "${sanitizedClaim}"
    
    Sources:
    ${sourcesText || 'No sources available'}
    
    Rate the claim's credibility on a scale of 1-10 where:
    1-3: Likely false or misleading
    4-6: Uncertain or mixed evidence
    7-10: Likely true or well-supported
    
    Provide your assessment in this JSON format:
    {
      "rating": 8,
      "confidence": 0.85,
      "explanation": "Detailed explanation of the assessment",
      "keyEvidence": ["Most important supporting evidence points"]
    }
  `;
  
  try {
    const response = await callGeminiAPI(prompt, apiKey);
    const result = JSON.parse(cleanJsonResponse(response.text));
    
    // Validate and clean result
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid response format');
    }
    
    return {
      rating: Math.max(1, Math.min(10, Math.round(result.rating || 5))),
      confidence: Math.max(0, Math.min(1, result.confidence || 0.1)),
      explanation: (result.explanation || 'No explanation provided').substring(0, 500),
      keyEvidence: Array.isArray(result.keyEvidence) ? 
        result.keyEvidence.filter(item => typeof item === 'string').slice(0, 5) : 
        []
    };
  } catch (error) {
    console.error('Failed to parse credibility JSON:', error);
    // Return a fallback response
    return {
      rating: 5,
      confidence: 0.1,
      explanation: "Unable to assess credibility due to parsing error",
      keyEvidence: ["Assessment failed"]
    };
  }
}

function calculateOverallCredibility(factCheckResults) {
  if (factCheckResults.length === 0) {
    return { rating: 0, confidence: 0, explanation: "No claims to evaluate" };
  }
  
  // Weighted average based on confidence and number of sources
  let totalWeight = 0;
  let weightedSum = 0;
  
  factCheckResults.forEach(result => {
    const weight = result.credibilityRating.confidence * result.sources.length;
    weightedSum += result.credibilityRating.rating * weight;
    totalWeight += weight;
  });
  
  const overallRating = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  // Determine overall assessment
  let assessment = "Uncertain";
  if (overallRating >= 7) assessment = "Likely True";
  else if (overallRating <= 3) assessment = "Likely False";
  else assessment = "Mixed Evidence";
  
  return {
    rating: Math.round(overallRating * 10) / 10,
    confidence: Math.min(totalWeight / factCheckResults.length, 1),
    assessment,
    explanation: `Based on ${factCheckResults.length} claim(s) with ${Math.round(totalWeight)} total source weight`
  };
}

async function callGeminiAPI(prompt, apiKey, retryCount = 0) {
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds base delay
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
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
        // Enable search grounding for fact-checking
        tools: [{
          googleSearch: {}
        }]
      })
    });
    
    if (!response.ok) {
      if (response.status === 429 && retryCount < maxRetries) {
        // Rate limit hit - wait and retry with exponential backoff
        const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
        console.log(`Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callGeminiAPI(prompt, apiKey, retryCount + 1);
      }
      
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Handle grounding metadata and extract text content
    const candidate = data.candidates[0];
    let textContent = '';
    let groundingMetadata = null;
    
    // Extract text content from the response
    if (candidate.content && candidate.content.parts) {
      textContent = candidate.content.parts
        .filter(part => part.text)
        .map(part => part.text)
        .join(' ');
    }
    
    // Extract grounding metadata if available
    if (candidate.groundingMetadata) {
      groundingMetadata = candidate.groundingMetadata;
    }
    
    // Return both text and grounding metadata
    return {
      text: textContent,
      groundingMetadata: groundingMetadata,
      fullResponse: data
    };
  } catch (error) {
    if (error.message.includes('429') && retryCount < maxRetries) {
      // Network error with 429 - retry with exponential backoff
      const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
      console.log(`Network error, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiAPI(prompt, apiKey, retryCount + 1);
    }
    throw error;
  }
}

function cleanJsonResponse(response) {
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
    console.warn('JSON parsing failed, attempting to fix:', error.message);
    
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

async function getApiKey() {
  // Use the provided API key directly
  return geminiAPIKey;
}

async function updateStats() {
  try {
    const result = await chrome.storage.local.get(['stats']);
    const stats = result.stats || { totalChecks: 0, todayChecks: 0, lastCheckDate: null };
    
    const today = new Date().toDateString();
    
    // Reset today's count if it's a new day
    if (stats.lastCheckDate !== today) {
      stats.todayChecks = 0;
      stats.lastCheckDate = today;
    }
    
    // Increment counters
    stats.totalChecks += 1;
    stats.todayChecks += 1;
    
    await chrome.storage.local.set({ stats });
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Authentication functions
async function checkAuthentication(sendResponse) {
  try {
    const result = await checkAuthenticationSync();
    sendResponse(result);
  } catch (error) {
    console.error('Auth check error:', error);
    sendResponse({ authenticated: false, error: error.message });
  }
}

async function checkAuthenticationSync() {
  try {
    const result = await chrome.storage.local.get(['authToken', 'userInfo']);
    const token = result.authToken;
    const userInfo = result.userInfo;
    
    if (!token || !userInfo) {
      return { authenticated: false };
    }
    
    // Verify token with API
    const apiDomain = 'https://fact-checker-website.vercel.app';
    const response = await fetch(`${apiDomain}/api/me/limits`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
      // Token invalid, clear it
      await chrome.storage.local.remove(['authToken', 'userInfo']);
      return { authenticated: false };
    }
    
    const data = await response.json();
    return {
      authenticated: true,
      plan: data.plan || 'free',
      userInfo: userInfo
    };
  } catch (error) {
    console.error('Auth check error:', error);
    return { authenticated: false, error: error.message };
  }
}

// Usage statistics functions
async function getUsageStats(sendResponse) {
  try {
    const result = await getUsageStatsSync();
    sendResponse(result);
  } catch (error) {
    console.error('Usage stats error:', error);
    sendResponse({ error: error.message });
  }
}

async function getUsageStatsSync() {
  try {
    const result = await chrome.storage.local.get(['stats']);
    const stats = result.stats || { totalChecks: 0, todayChecks: 0, lastCheckDate: null };
    
    const today = new Date().toDateString();
    
    // Reset today's count if it's a new day
    if (stats.lastCheckDate !== today) {
      stats.todayChecks = 0;
      stats.lastCheckDate = today;
      await chrome.storage.local.set({ stats });
    }
    
    return {
      totalChecks: stats.totalChecks,
      todayChecks: stats.todayChecks,
      lastCheckDate: stats.lastCheckDate
    };
  } catch (error) {
    console.error('Usage stats error:', error);
    return { totalChecks: 0, todayChecks: 0, lastCheckDate: null };
  }
}