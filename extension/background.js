// Background script for handling API calls to backend
const API_BASE_URL = 'https://fact-checker-website.vercel.app'; // Vercel production server

/**
 * Listens for when the extension is installed or updated.
 * Logs a message to confirm the extension installation.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Social Media Fact Checker extension installed');
});

/**
 * Main message handler that routes incoming messages from content scripts and popup
 * to appropriate handler functions based on the action type.
 * 
 * @param {Object} request - The message object containing action and data
 * @param {Object} sender - Information about the sender
 * @param {Function} sendResponse - Callback function to send a response
 * @returns {boolean} Returns true to keep the message channel open for async responses
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'factCheck') {
    handleFactCheck(request.data, sendResponse);
    return true; // Keep message channel open for async response
  } else if (request.action === 'extractImageText') {
    handleImageExtraction(request.images, sendResponse);
    return true; // Keep message channel open for async response
  } else if (request.action === 'ping') {
    // Respond to ping to verify extension context is valid
    sendResponse({ status: 'ok' });
    return false;
  } else if (request.action === 'getUserStatus') {
    getUserStatus(sendResponse);
    return true;
  } else if (request.action === 'fetchImageAsBase64') {
    handleFetchImageAsBase64(request.imageUrl, sendResponse);
    return true; // Keep message channel open for async response
  }
});

/**
 * Handles fact check requests from content scripts by forwarding them to the backend API.
 * Validates input data, checks user authentication, handles quota limits, and returns results.
 * 
 * @param {Object} data - The post data to fact check (text, claims, platform, url, postDate, timestamp)
 * @param {Function} sendResponse - Callback function to send the response back to the content script
 */
async function handleFactCheck(data, sendResponse) {
  try {
    // Validate input data
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided');
    }
    console.log(data);
    const { text, claims, images, imageTexts, platform, postDate } = data;
    
    // Validate required fields
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('No text content found to analyze');
    }
    
    // Call backend API for fact checking
    const response = await fetch(`${API_BASE_URL}/api/fact-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        text: text,
        claims: claims,
        images: images || [],
        imageTexts: imageTexts || [],
        postDate: postDate
      }),
      credentials: 'include' // Send session cookie
    });

    if (response.status === 401) {
      // Not signed in - open login page
      chrome.tabs.create({ url: `${API_BASE_URL}/login?from=extension` });
      throw new Error('Please sign in on the website to use fact checking');
    }

    if (response.status === 402) {
      // Quota exceeded - open upgrade page
      const data = await response.json();
      chrome.tabs.create({ url: data.upgradeUrl || `${API_BASE_URL}/upgrade` });
      throw new Error('Free quota exceeded. Please upgrade to Pro for unlimited fact checks');
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fact check');
    }

    const result = await response.json();
    
    // Update usage statistics
    await updateStats();
    
    sendResponse({
      success: true,
      results: result
    });
    
  } catch (error) {
    console.error('Fact check error:', error);
    sendResponse({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
}

/**
 * Handles image text extraction requests by sending images to the backend API for OCR processing.
 * Validates input, checks authentication and quotas, and returns extracted text and claims.
 * 
 * @param {Array} images - Array of base64-encoded image data URIs
 * @param {Function} sendResponse - Callback function to send the response back to the content script
 */
async function handleImageExtraction(images, sendResponse) {
  try {
    // Validate input
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided');
    }

    // Call backend API for image extraction
    const response = await fetch(`${API_BASE_URL}/api/image-extraction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: images,
        extractClaims: true // Automatically extract claims from images
      }),
      credentials: 'include' // Send session cookie
    });

    if (response.status === 401) {
      // Not signed in - open login page
      chrome.tabs.create({ url: `${API_BASE_URL}/login?from=extension` });
      throw new Error('Please sign in on the website to use image extraction');
    }

    if (response.status === 402) {
      // Quota exceeded - open upgrade page
      const data = await response.json();
      chrome.tabs.create({ url: data.upgradeUrl || `${API_BASE_URL}/billing` });
      throw new Error('Free quota exceeded. Please upgrade to Pro for unlimited image extraction');
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to extract text from images');
    }

    const result = await response.json();
    
    sendResponse({
      success: true,
      extractedText: result.extractedText || '',
      claims: result.claims || ''
    });
    
  } catch (error) {
    console.error('Image extraction error:', error);
    sendResponse({
      success: false,
      error: error.message || 'An unexpected error occurred',
      extractedText: '',
      claims: ''
    });
  }
}

/**
 * Fetches an image from a URL and converts it to a base64 data URI.
 * This is used to bypass CORS restrictions when content scripts cannot directly access images.
 * 
 * @param {string} imageUrl - The URL of the image to fetch
 * @param {Function} sendResponse - Callback function to send the response back to the content script
 */
async function handleFetchImageAsBase64(imageUrl, sendResponse) {
  try {
    // Fetch image as blob (background script can bypass CORS for permitted hosts)
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();
    
    // Convert blob to base64 (FileReader not available in service workers, use arrayBuffer)
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert bytes to base64 string
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64String = 'data:' + blob.type + ';base64,' + btoa(binary);
    
    sendResponse({
      success: true,
      base64: base64String
    });
    
  } catch (error) {
    console.error('Error fetching image as base64:', error);
    sendResponse({
      success: false,
      error: error.message || 'Failed to fetch image'
    });
  }
}

/**
 * Retrieves the current user's authentication status and profile information from the backend.
 * 
 * @param {Function} sendResponse - Callback function to send the response back to the requester
 */
async function getUserStatus(sendResponse) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/me`, {
      credentials: 'include'
    });

    if (response.ok) {
      const userData = await response.json();
      sendResponse({ success: true, user: userData });
    } else {
      sendResponse({ success: false, user: null });
    }
  } catch (error) {
    console.error('Error getting user status:', error);
    sendResponse({ success: false, user: null });
  }
}

/**
 * Updates local storage statistics for fact checks performed.
 * Tracks total checks and daily checks, resetting the daily count when the date changes.
 */
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

/***** ===== Prompt API (LanguageModel) bridge: ADD BELOW YOUR EXISTING CODE ===== *****/

/**
 * Checks if the LanguageModel (Gemini Nano) API is available and ready to use.
 * Handles model download if needed and returns availability status.
 * 
 * @returns {Promise<Object>} An object with ok boolean and reason string indicating availability status
 */
async function __ensureModelReady() {
  try {
    if (!globalThis.LanguageModel?.availability) {
      return { ok: false, reason: "Prompt API unavailable" };
    }
    let status = await LanguageModel.availability(); // "available" | "unavailable" | "downloadable" | "after-download"
    if (status === "downloadable") {
      // In some builds, creating a session triggers the download
      try { const s = await LanguageModel.create({}); await s?.destroy?.(); } catch {}
      status = await LanguageModel.availability();
    }
    return { ok: status === "available", reason: status };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Executes a prompt using the LanguageModel API with an optional system prompt.
 * Creates a session, sends the prompt, and cleans up the session afterward.
 * 
 * @param {Object} params - Object containing systemPrompt (optional) and userText (required)
 * @param {string} params.systemPrompt - Optional system prompt to configure the model behavior
 * @param {string} params.userText - The user's text input to process (max 12000 characters)
 * @returns {Promise<string>} The model's response text
 */
async function __runPrompt({ systemPrompt, userText }) {
  const ready = await __ensureModelReady();
  if (!ready.ok) throw new Error(`Model not ready: ${ready.reason}`);

  let session;
  try {
    session = await LanguageModel.create(
      systemPrompt ? { systemPrompt } : {}
    );
    const out = await session.prompt(String(userText || "").slice(0, 12000));
    return out;
  } finally {
    try { await session?.destroy?.(); } catch {}
  }
}

/**
 * Additional message listener specifically for Prompt API requests from content scripts.
 * Handles claim extraction and generic prompt execution using the on-device LanguageModel.
 * 
 * @param {Object} request - The message object containing type/action and text/prompt
 * @param {Object} sender - Information about the sender
 * @param {Function} sendResponse - Callback function to send the response
 * @returns {boolean} Returns true to keep the message channel open for async responses
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // New, claim-extraction flow used by your content script
  if (request?.type === "PROMPT_EXTRACT_CLAIMS" && typeof request.text === "string") {
    (async () => {
      try {
        const systemPrompt =
          "Extract 2-3 verifiable claims from the content in the social media post. Each claim should be a single statement that can be verified or denied. Don't include any other text I just want the claims. DO NOT USE EMOJIS OR ANY OTHER SYMBOLS." +
          "Do not give any analysis or commentary. Return ONLY short bullets, each starting with '- '. No extra prose.";
        const claims = await __runPrompt({ systemPrompt, userText: request.text });
        sendResponse({ success: true, claims });
      } catch (e) {
        sendResponse({ success: false, error: String(e?.message || e) });
      }
    })();
    return true; // keep channel open for async response
  }

  // Optional compatibility: generic prompt runner (matches your earlier example name)
  if (request?.action === "runGeminiPrompt" && typeof request.prompt === "string") {
    (async () => {
      try {
        const result = await __runPrompt({ userText: request.prompt });
        sendResponse({ success: true, response: result });
      } catch (e) {
        sendResponse({ success: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});
