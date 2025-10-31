// Background script for handling API calls to backend
const API_BASE_URL = 'https://fact-checker-website.vercel.app'; // Vercel production server

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
  } else if (request.action === 'getUserStatus') {
    getUserStatus(sendResponse);
    return true;
  }
});

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

// Ensure Gemini Nano (on-device model) is ready
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

// Run one prompt with an optional system prompt
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

// Listener #2: handle Prompt API requests (kept separate to avoid touching your existing listener)
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
