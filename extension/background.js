// Background script for handling API calls to backend
const API_BASE_URL = 'https://fact-checker-website.vercel.app/'; // Replace with your actual domain

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
    
    const { text, images, imageTexts, platform, postDate } = data;
    
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
