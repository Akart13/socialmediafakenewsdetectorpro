// Content script for extracting text from social media posts
class SocialMediaExtractor {
  /**
   * Initializes the SocialMediaExtractor class by detecting the current platform
   * and setting up the necessary functionality for fact checking posts.
   */
  constructor() {
    this.platform = this.detectPlatform();
    this.init();
  }

  /**
   * Detects which social media platform the user is currently on by checking the hostname.
   * Supports Twitter/X, Instagram, and Facebook platforms.
   * 
   * @returns {string} The platform name ('twitter', 'instagram', 'facebook', or 'unknown')
   */
  detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'twitter';
    } else if (hostname.includes('instagram.com')) {
      return 'instagram';
    } else if (hostname.includes('facebook.com')) {
      return 'facebook';
    }
    return 'unknown';
  }

  /**
   * Initializes the fact checking functionality by verifying extension validity,
   * adding fact check buttons to posts, and setting up page change observation.
   */
  init() {
    this.checkExtensionValidity();
    this.addFactCheckButtons();
    this.observePageChanges();
  }

  /**
   * Checks if the Chrome extension context is still valid and active.
   * Verifies connectivity with the background script and displays a warning
   * message if the extension context has been invalidated.
   */
  checkExtensionValidity() {
    // Check if the extension context is still valid
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      console.warn('Extension context invalidated - extension may need to be reloaded');
      this.showContextInvalidatedMessage();
      return;
    }

    // Send a ping to the background script to verify connectivity
    chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Extension context invalidated:', chrome.runtime.lastError.message);
        this.showContextInvalidatedMessage();
      }
    });
  }

  /**
   * Displays a user-friendly notification message when the extension context
   * has been invalidated, typically after the extension is reloaded.
   * The message appears in the top-right corner and auto-dismisses after 5 seconds.
   */
  showContextInvalidatedMessage() {
    // Show a user-friendly message when extension context is invalidated
    const existingMessage = document.querySelector('.fact-check-context-invalidated');
    if (existingMessage) {
      return; // Don't show multiple messages
    }

    const message = document.createElement('div');
    message.className = 'fact-check-context-invalidated';
    message.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff6b6b;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 300px;
    `;
    message.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">Extension Reloaded</div>
      <div style="font-size: 12px; opacity: 0.9;">Please refresh the page to continue using fact-checking</div>
    `;

    document.body.appendChild(message);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 5000);
  }

  /**
   * Scans the page for social media posts and adds fact check buttons to each post
   * that doesn't already have one. This ensures all visible posts can be fact checked.
   */
  addFactCheckButtons() {
    // Add fact-check buttons to posts
    const posts = this.getPosts();
    posts.forEach(post => {
      if (!post.querySelector('.fact-check-btn')) {
        this.addFactCheckButton(post);
      }
    });
  }

  /**
   * Retrieves all social media post elements from the current page based on the detected platform.
   * Uses platform-specific CSS selectors to find posts.
   * 
   * @returns {NodeList} A list of post elements found on the page
   */
  getPosts() {
    switch (this.platform) {
      case 'twitter':
        return document.querySelectorAll('[data-testid="tweet"]');
      case 'instagram':
        return document.querySelectorAll('article');
      case 'facebook':
        return document.querySelectorAll('[data-pagelet="FeedUnit_0"]');
      default:
        return [];
    }
  }

  /**
   * Creates and adds a fact check button to a specific social media post.
   * The button is styled and positioned appropriately for the current platform.
   * 
   * @param {HTMLElement} post - The DOM element representing a social media post
   */
  addFactCheckButton(post) {
    const button = document.createElement('button');
    button.className = 'fact-check-btn';
    button.innerHTML = '🔍 Fact Check';
    button.style.cssText = `
      background: #1da1f2;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      margin: 8px 0;
      font-weight: bold;
    `;

    button.addEventListener('click', () => {
      this.factCheckPost(post);
    });

    // Insert button in appropriate location based on platform
    const container = this.getButtonContainer(post);
    if (container) {
      container.appendChild(button);
    }
  }

  /**
   * Finds the appropriate container element within a post where the fact check button should be inserted.
   * Different platforms have different DOM structures for their action buttons.
   * 
   * @param {HTMLElement} post - The DOM element representing a social media post
   * @returns {HTMLElement|null} The container element where the button should be placed, or null if not found
   */
  getButtonContainer(post) {
    switch (this.platform) {
      case 'twitter':
        return post.querySelector('[role="group"]') || post.querySelector('[data-testid="reply"]')?.parentElement;
      case 'instagram':
        return post.querySelector('section > div:last-child');
      case 'facebook':
        return post.querySelector('[role="button"][aria-label*="Like"]')?.parentElement;
      default:
        return post;
    }
  }

  /**
   * Performs a fact check on a social media post by extracting its content,
   * including text and images, then sending it to the backend API for analysis.
   * Displays the results in an interactive overlay when complete.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post to fact check
   */
  async factCheckPost(post) {
    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      this.showError(post, 'Extension context invalidated. Please refresh the page.');
      this.showContextInvalidatedMessage();
      return;
    }

    const button = post.querySelector('.fact-check-btn');
    if (button) {
      button.innerHTML = '⏳ Checking...';
      button.disabled = true;
    }

    try {
      const postData = await this.extractPostData(post);

      // Extract text from images if any are present
      let imageText = '';
      let imageClaims = '';
      if (postData.imageElements && postData.imageElements.length > 0) {
        try {
          const imageExtraction = await this.extractTextFromImages(postData.imageElements);
          imageText = imageExtraction.extractedText || '';
          imageClaims = imageExtraction.claims || '';
          
          // Combine extracted image text with post text
          if (imageText) {
            postData.text = postData.text 
              ? `${postData.text}\n\n[Text from images: ${imageText}]`
              : imageText;
          }
        } catch (error) {
          console.warn('Image extraction failed, continuing without image text:', error);
          // Continue with text-only fact check
        }
      }

      // NEW: get claims from Prompt API via background (does not overwrite text)
      const enriched = await this.generateClaimsWithPromptAPI(postData);

      // If we got claims from images, combine them with extracted claims
      if (imageClaims) {
        enriched.claims = enriched.claims 
          ? `${enriched.claims}\n${imageClaims}`
          : imageClaims;
      }

      // Remove imageElements before sending (not needed in request)
      const { imageElements, ...dataToSend } = enriched;

      // Pass enriched data downstream (background will ignore unknown fields if any)
      const result = await this.sendFactCheckRequest(dataToSend);
      this.displayResults(post, result);
    } catch (error) {
      console.error('Fact check error:', error);
      this.showError(post, error.message);
    } finally {
      if (button) {
        button.innerHTML = '🔍 Fact Check';
        button.disabled = false;
      }
    }
  }

  /**
   * Generates verifiable claims from post text using the Prompt API (LanguageModel)
   * via the background script. This extracts 2-3 key claims that can be verified.
   * Falls back gracefully if the API is unavailable.
   * 
   * @param {Object} postData - The post data object containing text and other metadata
   * @returns {Object} The post data object with an additional 'claims' property containing extracted claims
   */
  async generateClaimsWithPromptAPI(postData) {
    const text = (postData?.text || "").slice(0, 12000);
    if (!text) return postData;

    // If the extension context is invalid or SW sleeping, we'll fall back gracefully.
    const callBackground = () => new Promise((resolve, reject) => {
      if (!chrome.runtime?.sendMessage) {
        reject(new Error('Extension context invalidated'));
        return;
      }
      try {
        chrome.runtime.sendMessage(
          { type: "PROMPT_EXTRACT_CLAIMS", text },
          (resp) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            if (!resp) return reject(new Error("No response from background"));
            resp.success ? resolve(resp.claims) : reject(new Error(resp.error));
          }
        );
      } catch (e) { reject(e); }
    });

    try {
      const claimsBullets = await callBackground();
      // IMPORTANT: do NOT overwrite original text
      return { ...postData, claims: claimsBullets };
    } catch (e) {
      console.warn("Prompt API (background) failed; proceeding without claims:", e);
      return postData; // graceful fallback, keep text unchanged
    }
  }

  /**
   * Extracts all relevant data from a social media post including text content,
   * images, platform information, URL, and timestamp.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @returns {Object} An object containing extracted post data (text, images, platform, url, postDate, timestamp)
   * @throws {Error} If the post element is invalid or contains no extractable content
   */
  async extractPostData(post) {
    if (!post || !post.nodeType) {
      throw new Error('Invalid post element provided');
    }
    
    const imageElements = this.extractImages(post);
    const text = this.extractText(post);
    const postDate = this.extractPostDate(post);
    
    // Validate that we have some text or images to analyze
    if ((!text || text.trim().length === 0) && (!imageElements || imageElements.length === 0)) {
      throw new Error('No text content or images found in the post');
    }
    
    return {
      text: text || '',
      imageElements: imageElements, // Store image elements for later processing
      platform: this.platform,
      url: window.location.href,
      postDate: postDate,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extracts text content from a social media post using platform-specific selectors.
   * Different platforms have different DOM structures for displaying post text.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @returns {string} The extracted text content from the post
   */
  extractText(post) {
    switch (this.platform) {
      case 'twitter':
        const tweetText = post.querySelector('[data-testid="tweetText"]');
        return tweetText ? tweetText.innerText : '';
      
      case 'instagram':
        const caption = post.querySelector('h1, span[dir="auto"]');
        return caption ? caption.innerText : '';
      
      case 'facebook':
        const postText = post.querySelector('[data-ad-preview="message"]') || 
                        post.querySelector('[data-testid="post_message"]');
        return postText ? postText.innerText : '';
      
      default:
        return post.innerText;
    }
  }

  /**
   * Extracts image elements from a social media post, filtering out small images
   * like avatars and icons. Returns up to 5 images per post.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @returns {Array} An array of image elements found in the post (max 5)
   */
  extractImages(post) {
    const images = [];
    let imageElements = [];

    switch (this.platform) {
      case 'twitter':
        // Twitter/X images can be in various places
        imageElements = post.querySelectorAll('img[src*="pbs.twimg.com"], img[src*="abs.twimg.com"], [data-testid="tweetPhoto"] img, article img[alt*="Image"]');
        break;
      
      case 'instagram':
        // Instagram images
        imageElements = post.querySelectorAll('img[src*="instagram.com"], article img');
        break;
      
      case 'facebook':
        // Facebook images
        imageElements = post.querySelectorAll('img[src*="fbcdn.net"], img[src*="facebook.com"], [data-imgperflogname="feedCoverPhoto"] img');
        break;
      
      default:
        imageElements = post.querySelectorAll('img');
    }

    // Filter out very small images (likely icons/avatars)
    imageElements.forEach(img => {
      if (img.naturalWidth > 100 && img.naturalHeight > 100 && 
          img.complete && !img.src.includes('data:image/svg')) {
        images.push(img);
      }
    });

    return images.slice(0, 5); // Limit to 5 images
  }

  /**
   * Converts an image element to a base64-encoded data URI.
   * Handles CORS issues by attempting to fetch via the background script if direct conversion fails.
   * 
   * @param {HTMLImageElement} img - The image element to convert
   * @returns {Promise<string>} A promise that resolves to a base64 data URI string
   */
  async imageToBase64(img) {
    return new Promise((resolve, reject) => {
      // Check if image is already a data URI
      if (img.src.startsWith('data:')) {
        resolve(img.src);
        return;
      }

      // Create canvas to convert image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const imgLoad = new Image();
      
      imgLoad.crossOrigin = 'anonymous';
      
      imgLoad.onload = () => {
        try {
          // Set canvas dimensions
          canvas.width = Math.min(imgLoad.width, 1920); // Max width to reduce size
          canvas.height = Math.min(imgLoad.height, 1920); // Max height
          
          // Draw image on canvas
          ctx.drawImage(imgLoad, 0, 0, canvas.width, canvas.height);
          
          // Convert to base64
          const base64 = canvas.toDataURL('image/jpeg', 0.85); // JPEG with 85% quality
          resolve(base64);
        } catch (error) {
          console.warn('Failed to convert image to base64:', error);
          reject(error);
        }
      };
      
      imgLoad.onerror = () => {
        // Fallback: try to fetch the image via background script if CORS blocks
        console.warn('Image load failed due to CORS, attempting fetch via background:', img.src);
        // Try to fetch via background script
        if (chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(
            {
              action: 'fetchImageAsBase64',
              imageUrl: img.src
            },
            (response) => {
              if (response && response.success && response.base64) {
                resolve(response.base64);
              } else {
                reject(new Error('Image fetch failed via background'));
              }
            }
          );
        } else {
          reject(new Error('Image load failed and background not available'));
        }
      };
      
      imgLoad.src = img.src;
    });
  }

  /**
   * Extracts text content from one or more images by converting them to base64
   * and sending them to the backend API for OCR processing.
   * Also extracts claims from the image text if available.
   * 
   * @param {Array} images - An array of image elements to extract text from
   * @returns {Promise<Object>} An object containing extractedText and claims strings
   */
  async extractTextFromImages(images) {
    if (!images || images.length === 0) {
      return { extractedText: '', claims: '' };
    }

    try {
      // Convert all images to base64
      const base64Images = [];
      for (const img of images) {
        try {
          const base64 = await this.imageToBase64(img);
          base64Images.push(base64);
        } catch (error) {
          console.warn('Skipping image due to conversion error:', error);
          // Continue with other images
        }
      }

      if (base64Images.length === 0) {
        return { extractedText: '', claims: '' };
      }

      // Send to background script for processing
      return new Promise((resolve, reject) => {
        if (!chrome.runtime?.sendMessage) {
          reject(new Error('Extension context invalidated'));
          return;
        }

        chrome.runtime.sendMessage(
          {
            action: 'extractImageText',
            images: base64Images
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response) {
              reject(new Error('No response from background'));
              return;
            }
            if (response.success) {
              resolve({
                extractedText: response.extractedText || '',
                claims: response.claims || ''
              });
            } else {
              reject(new Error(response.error || 'Image extraction failed'));
            }
          }
        );
      });
    } catch (error) {
      console.error('Error extracting text from images:', error);
      return { extractedText: '', claims: '' }; // Graceful fallback
    }
  }

  /**
   * Extracts the publication date from a social media post using platform-specific
   * selectors. Falls back to the current date if extraction fails.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @returns {string} An ISO string representation of the post date
   */
  extractPostDate(post) {
    try {
      switch (this.platform) {
        case 'twitter':
          // Try multiple selectors for Twitter post dates
          const timeElement = post.querySelector('time') || 
                            post.querySelector('[datetime]') ||
                            post.querySelector('[data-testid="tweet"] time') ||
                            post.querySelector('a[href*="/status/"] time');
          
          if (timeElement) {
            const datetime = timeElement.getAttribute('datetime') || 
                           timeElement.getAttribute('title') ||
                           timeElement.textContent;
            if (datetime) {
              return new Date(datetime).toISOString();
            }
          }
          break;
          
        case 'instagram':
          // Try to find Instagram post date
          const instagramTime = post.querySelector('time') ||
                              post.querySelector('[datetime]') ||
                              post.querySelector('a[href*="/p/"] time');
          
          if (instagramTime) {
            const datetime = instagramTime.getAttribute('datetime') || 
                           instagramTime.getAttribute('title') ||
                           instagramTime.textContent;
            if (datetime) {
              return new Date(datetime).toISOString();
            }
          }
          break;
          
        case 'facebook':
          // Try to find Facebook post date
          const facebookTime = post.querySelector('time') ||
                             post.querySelector('[datetime]') ||
                             post.querySelector('a[href*="/posts/"] time') ||
                             post.querySelector('[data-testid="post_message"] time');
          
          if (facebookTime) {
            const datetime = facebookTime.getAttribute('datetime') || 
                           facebookTime.getAttribute('title') ||
                           facebookTime.textContent;
            if (datetime) {
              return new Date(datetime).toISOString();
            }
          }
          break;
      }
    } catch (error) {
      console.warn('Failed to extract post date:', error);
    }
    
    // Fallback to current time if date extraction fails
    return new Date().toISOString();
  }

  /**
   * Sends a fact check request to the background script, which forwards it to the backend API.
   * Handles extension context validation and error responses.
   * 
   * @param {Object} data - The post data to fact check (text, claims, platform, url, postDate, timestamp)
   * @returns {Promise<Object>} A promise that resolves to the fact check results
   */
  async sendFactCheckRequest(data) {
    return new Promise((resolve, reject) => {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension context invalidated. Please refresh the page.'));
        return;
      }

      chrome.runtime.sendMessage({
        action: 'factCheck',
        data: {
          text: data.text,
          // NEW: include claims if present (background may ignore; harmless)
          claims: data.claims || "",
          platform: data.platform,
          url: data.url,
          postDate: data.postDate,
          timestamp: data.timestamp
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          if (error.includes('Extension context invalidated') || error.includes('Receiving end does not exist')) {
            reject(new Error('Extension context invalidated. Please refresh the page and try again.'));
          } else {
            reject(new Error(error));
          }
        } else if (response && response.success) {
          resolve(response.results);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      });
    });
  }

  /**
   * Displays fact check results for a post by removing any existing results
   * and showing a new interactive overlay with the analysis.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @param {Object} results - The fact check results to display
   */
  displayResults(post, results) {
    // Remove existing results
    const existingResults = post.querySelector('.fact-check-results');
    if (existingResults) {
      existingResults.remove();
    }

    // Create and show interactive overlay (popup)
    this.showInteractiveOverlay(results);
  }

  /**
   * Displays fact check results in a clean, formatted way directly below the post.
   * This is an alternative display method to the interactive overlay.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @param {Object} data - The fact check data containing verdict, rationale, and sources
   */
  showCleanResults(post, data) {
    const { verdict, rationale, sources } = data;
    
    // Helper function to clean URLs for display
    function human(url) { 
      try { 
        return new URL(url).hostname.replace(/^www\./,''); 
      } catch { 
        return url; 
      } 
    }

    const sourcesList = sources.map(u => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${human(u)}</a></li>`).join("");

    const html = `
      <div class="fact-check-result">
        <div><b>Verdict:</b> ${verdict}</div>
        <div>${rationale}</div>
        ${sources.length ? `<div><b>Sources</b><ul>${sourcesList}</ul></div>` : `<div><i>No grounded sources</i></div>`}
      </div>`;

    // Create results container
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'fact-check-results';
    resultsContainer.innerHTML = html;
    
    // Add some basic styling
    resultsContainer.style.cssText = `
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 16px;
      margin: 8px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
    `;
    
    // Style the links
    const links = resultsContainer.querySelectorAll('a');
    links.forEach(link => {
      link.style.cssText = `
        color: #007bff;
        text-decoration: none;
        font-weight: 500;
      `;
    });
    
    // Style the list
    const ulElement = resultsContainer.querySelector('ul');
    if (ulElement) {
      ulElement.style.cssText = `
        margin: 8px 0 0 0;
        padding-left: 20px;
        list-style-type: disc;
      `;
    }

    // Insert after the post
    post.parentNode.insertBefore(resultsContainer, post.nextSibling);
  }

  /**
   * Creates and displays an interactive modal overlay with detailed fact check results.
   * The overlay includes overall ratings, individual claim analysis, and source citations.
   * 
   * @param {Object} results - The fact check results object containing overallRating and claims
   */
  showInteractiveOverlay(results) {
    // Remove any existing overlay
    const existingOverlay = document.querySelector('.fact-check-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Extract clean data from the complex response format
    const verdict = results.overallRating?.assessment || "Unverifiable";
    const rationale = results.overallRating?.explanation || "No rationale provided.";
    const sources = results.claims?.[0]?.sources?.map(s => s.url) || [];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'fact-check-overlay';
    
    // Overall rating with null checks
    const overallRating = results.overallRating || { rating: 5, confidence: 0.5, assessment: verdict, explanation: rationale };
    const ratingClass = (overallRating.rating || 5) >= 7 ? 'rating-high' : 
                       (overallRating.rating || 5) >= 4 ? 'rating-medium' : 'rating-low';
    
    // Helper function to clean URLs for display
    function human(url) { 
      try { 
        return new URL(url).hostname.replace(/^www\./,''); 
      } catch { 
        return url; 
      } 
    }

    // Build claims HTML
    let claimsHtml = '';
    if (results.claims && results.claims.length > 0) {
      claimsHtml = results.claims.map((claim, index) => {
        const claimRating = claim.credibilityRating || { rating: 5, confidence: 0.5, explanation: "No analysis available", keyEvidence: [], groundingUsed: false };
        const claimRatingClass = (claimRating.rating || 5) >= 7 ? 'rating-high' : 
                                (claimRating.rating || 5) >= 4 ? 'rating-medium' : 'rating-low';
        
        let sourcesHtml = '';
        if (claim.sources && claim.sources.length > 0) {
          sourcesHtml = `
            <div class="claim-sources">
              <div class="sources-title">
                📚 Sources (${claim.sources.length})
              </div>
              ${claim.sources.map(source => {
                const safeSource = {
                  url: source.url || "#",
                  title: source.title || human(source.url) || "Source",
                  credibilityScore: source.credibilityScore || 5,
                  relevanceScore: source.relevanceScore || 5,
                  summary: source.summary || ""
                };
                return `
                  <div class="source-item" onclick="window.open('${safeSource.url}', '_blank')" title="Click to open source">
                    <div class="source-header">
                      <a href="${safeSource.url}" target="_blank" rel="noopener" class="source-title-link" onclick="event.stopPropagation()">
                        <div class="source-title">${safeSource.title}</div>
                      </a>
                      <div class="source-scores">
                        <div class="source-score">
                          <span>📊</span>
                          <span>${safeSource.credibilityScore}/10</span>
                        </div>
                        <div class="source-score">
                          <span>🎯</span>
                          <span>${safeSource.relevanceScore}/10</span>
                        </div>
                      </div>
                    </div>
                    <div class="source-url-container">
                      <a href="${safeSource.url}" target="_blank" rel="noopener" class="source-url" title="Click to open full URL" onclick="event.stopPropagation()">${safeSource.url}</a>
                      <span class="source-link-indicator">🔗</span>
                    </div>
                    ${safeSource.summary ? `<div class="source-summary">${safeSource.summary}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }
        
        return `
          <div class="claim-item" data-claim-index="${index}">
            <div class="claim-header" data-expandable="true">
              <div class="claim-text">${claim.claim || "Unable to analyze claim"}</div>
              <div class="claim-rating-badge ${claimRatingClass}">
                ${claimRating.rating || 5}/10
              </div>
              <div class="claim-expand-icon">▼</div>
            </div>
            <div class="claim-content">
              <div class="claim-explanation">
                <strong>Assessment:</strong> ${claimRating.explanation || "No assessment available"}
              </div>
              ${sourcesHtml}
            </div>
          </div>
        `;
      }).join('');
    }
    
    overlay.innerHTML = `
      <div class="fact-check-modal">
        <div class="fact-check-header">
          <div class="fact-check-title">
            🔍 Fact Check Results
          </div>
          <button class="fact-check-close" data-close="true">×</button>
        </div>
        <div class="fact-check-content">
          <div class="overall-rating-section">
            <div class="overall-rating-header">
              <div class="overall-rating-title">Overall Assessment</div>
              <div class="overall-rating-badge ${ratingClass}">
                ${overallRating.rating || 5}/10 - ${overallRating.assessment || "Uncertain"}
              </div>
            </div>
            <div class="overall-rating-details">
              <div class="rating-metric">
                <div class="rating-metric-value">${overallRating.rating || 5}</div>
                <div class="rating-metric-label">Credibility Score</div>
              </div>
              <div class="rating-metric">
                <div class="rating-metric-value">${Math.round((overallRating.confidence || 0.5) * 100)}%</div>
                <div class="rating-metric-label">Confidence</div>
              </div>
            </div>
            <div class="overall-explanation">
              ${overallRating.explanation || "No explanation available"}
            </div>
          </div>
          
          <div class="claims-section">
            <div class="claims-header">
              📋 Individual Claims (${results.claims ? results.claims.length : 0})
            </div>
            ${claimsHtml}
          </div>
        </div>
      </div>
    `;

    // Add to document
    document.body.appendChild(overlay);

    // Add event listeners for interactive elements
    this.setupOverlayEventListeners(overlay);
  }

  /**
   * Sets up event listeners for the interactive overlay including close button,
   * expandable claims, overlay background clicks, and Escape key handling.
   * 
   * @param {HTMLElement} overlay - The overlay DOM element to attach listeners to
   */
  setupOverlayEventListeners(overlay) {
    // Close button functionality
    const closeButton = overlay.querySelector('[data-close="true"]');
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Close button clicked');
        overlay.remove();
      });
    }

    // Expandable claims functionality
    const claimHeaders = overlay.querySelectorAll('[data-expandable="true"]');
    console.log(`Found ${claimHeaders.length} expandable claim headers`);
    claimHeaders.forEach((header, index) => {
      header.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`Claim header ${index} clicked`);
        const claimItem = header.closest('.claim-item');
        if (claimItem) {
          claimItem.classList.toggle('claim-expanded');
          console.log('Claim expanded/collapsed');
        }
      });
    });

    // Close on overlay click (but not modal click)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        console.log('Overlay background clicked');
        overlay.remove();
      }
    });

    // Close on Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        console.log('Escape key pressed');
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Creates a DOM element displaying the overall credibility rating for the fact check.
   * Includes the assessment, rating score, confidence level, and explanation.
   * 
   * @param {Object} rating - The rating object containing assessment, rating, confidence, and explanation
   * @returns {HTMLElement} A styled container element displaying the overall rating
   */
  createOverallRating(rating) {
    const container = document.createElement('div');
    container.style.cssText = `
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
    `;

    const color = this.getRatingColor(rating.rating);
    container.style.backgroundColor = color.background;
    container.style.border = `2px solid ${color.border}`;

    const ratingText = document.createElement('div');
    ratingText.style.cssText = `
      font-size: 18px;
      font-weight: bold;
      color: ${color.text};
      margin-bottom: 4px;
    `;
    ratingText.textContent = `${rating.assessment} (${rating.rating}/10)`;

    const confidenceText = document.createElement('div');
    confidenceText.style.cssText = `
      font-size: 12px;
      color: #666;
    `;
    confidenceText.textContent = `Confidence: ${Math.round(rating.confidence * 100)}%`;

    const explanationText = document.createElement('div');
    explanationText.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    `;
    explanationText.textContent = rating.explanation;

    container.appendChild(ratingText);
    container.appendChild(confidenceText);
    container.appendChild(explanationText);

    return container;
  }

  /**
   * Creates a DOM section containing all individual claims with their ratings and explanations.
   * Each claim is displayed as a separate element with its own credibility assessment.
   * 
   * @param {Array} claims - An array of claim objects, each containing claim text, rating, and sources
   * @returns {HTMLElement} A container element holding all claim elements
   */
  createClaimsSection(claims) {
    const container = document.createElement('div');
    container.style.cssText = `
      border-top: 1px solid #e1e8ed;
      padding-top: 16px;
    `;

    const title = document.createElement('h4');
    title.style.cssText = `
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: bold;
      color: #333;
    `;
    title.textContent = 'Individual Claims:';

    container.appendChild(title);

    claims.forEach((claimData, index) => {
      const claimElement = this.createClaimElement(claimData, index);
      container.appendChild(claimElement);
    });

    return container;
  }

  /**
   * Creates a DOM element for a single claim including its text, credibility rating,
   * explanation, and associated sources with links.
   * 
   * @param {Object} claimData - The claim data object containing claim, credibilityRating, and sources
   * @param {number} index - The zero-based index of the claim in the list
   * @returns {HTMLElement} A styled container element representing a single claim
   */
  createClaimElement(claimData, index) {
    const container = document.createElement('div');
    container.style.cssText = `
      margin-bottom: 12px;
      padding: 12px;
      border: 1px solid #e1e8ed;
      border-radius: 8px;
      background: white;
    `;

    const claimText = document.createElement('div');
    claimText.style.cssText = `
      font-weight: bold;
      margin-bottom: 8px;
      color: #333;
    `;
    claimText.textContent = `Claim ${index + 1}: ${claimData.claim}`;

    const rating = document.createElement('div');
    rating.style.cssText = `
      font-size: 12px;
      margin-bottom: 8px;
    `;
    const color = this.getRatingColor(claimData.credibilityRating.rating);
    rating.innerHTML = `
      <span style="color: ${color.text}; font-weight: bold;">
        Rating: ${claimData.credibilityRating.rating}/10
      </span>
      <span style="color: #666; margin-left: 8px;">
        Confidence: ${Math.round(claimData.credibilityRating.confidence * 100)}%
      </span>
    `;

    const explanation = document.createElement('div');
    explanation.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
    `;
    explanation.textContent = claimData.credibilityRating.explanation;

    const sources = document.createElement('div');
    sources.style.cssText = `
      font-size: 11px;
    `;
    sources.innerHTML = `
      <strong>Sources (${claimData.sources.length}):</strong>
      <ul style="margin: 4px 0; padding-left: 16px;">
        ${claimData.sources.map(source => `
          <li style="margin-bottom: 8px;">
            <a href="${source.url}" target="_blank" style="color: #1da1f2; text-decoration: none; font-weight: 600; display: block; margin-bottom: 2px;" title="Click to open: ${source.url}">
              🔗 ${source.title}
            </a>
            <div style="color: #666; font-size: 11px; margin-left: 20px;">
              <a href="${source.url}" target="_blank" style="color: #888; text-decoration: underline; word-break: break-all;" title="Full URL: ${source.url}">
                ${source.url}
              </a>
              <br>
              <span style="color: #999;">
                (Credibility: ${source.credibilityScore}/10, Relevance: ${source.relevanceScore}/10)
              </span>
            </div>
          </li>
        `).join('')}
      </ul>
    `;

    container.appendChild(claimText);
    container.appendChild(rating);
    container.appendChild(explanation);
    container.appendChild(sources);

    return container;
  }

  /**
   * Returns color scheme (background, border, text) based on a credibility rating score.
   * High ratings (7+) use green, low ratings (<=3) use red, and medium ratings use yellow.
   * 
   * @param {number} rating - The credibility rating score from 1 to 10
   * @returns {Object} An object with background, border, and text color values
   */
  getRatingColor(rating) {
    if (rating >= 7) {
      return { background: '#d4edda', border: '#28a745', text: '#155724' };
    } else if (rating <= 3) {
      return { background: '#f8d7da', border: '#dc3545', text: '#721c24' };
    } else {
      return { background: '#fff3cd', border: '#ffc107', text: '#856404' };
    }
  }

  /**
   * Determines where to insert fact check results relative to a post based on the platform.
   * Different platforms have different DOM structures that require different insertion points.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post
   * @returns {HTMLElement} The DOM element where results should be inserted
   */
  getResultsInsertPoint(post) {
    switch (this.platform) {
      case 'twitter':
        return post.querySelector('[data-testid="reply"]')?.parentElement || post;
      case 'instagram':
        return post.querySelector('section > div:last-child') || post;
      case 'facebook':
        return post.querySelector('[role="button"][aria-label*="Like"]')?.parentElement || post;
      default:
        return post;
    }
  }

  /**
   * Displays an error message in an overlay modal when a fact check fails.
   * Handles both general errors and extension context invalidation errors with different UI.
   * 
   * @param {HTMLElement} post - The DOM element representing the social media post that failed
   * @param {string} message - The error message to display to the user
   */
  showError(post, message) {
    // Remove any existing overlay
    const existingOverlay = document.querySelector('.fact-check-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Special handling for context invalidation errors
    const isContextError = message.includes('Extension context invalidated');
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'fact-check-overlay';
    
    if (isContextError) {
      overlay.innerHTML = `
        <div class="fact-check-modal">
          <div class="fact-check-header">
            <div class="fact-check-title">
              ⚠️ Extension Update Required
            </div>
            <button class="fact-check-close" data-close="true">×</button>
          </div>
          <div class="fact-check-content">
            <div class="fact-check-error context-invalidated">
              <h4>Extension needs to be refreshed</h4>
              <p>The extension has been updated and needs to be refreshed to continue working properly.</p>
              <p>Please refresh this page to continue using the fact checker.</p>
              <button class="refresh-btn" onclick="window.location.reload()">Refresh Page</button>
            </div>
          </div>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <div class="fact-check-modal">
          <div class="fact-check-header">
            <div class="fact-check-title">
              ❌ Fact Check Error
            </div>
            <button class="fact-check-close" data-close="true">×</button>
          </div>
          <div class="fact-check-content">
            <div class="fact-check-error">
              <h4>Unable to complete fact check</h4>
              <p>${message}</p>
              <p>Please try again or check your internet connection.</p>
            </div>
          </div>
        </div>
      `;
    }

    // Add to document
    document.body.appendChild(overlay);

    // Add event listeners for interactive elements
    this.setupOverlayEventListeners(overlay);

    // Auto-close after timeout (longer for context errors)
    const timeout = isContextError ? 15000 : 8000;
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.remove();
      }
    }, timeout);
  }

  /**
   * Sets up a MutationObserver to watch for new posts being added to the page dynamically.
   * When new posts are detected, fact check buttons are automatically added to them.
   * This handles infinite scroll and lazy-loaded content.
   */
  observePageChanges() {
    // Use MutationObserver to handle dynamic content loading
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const posts = node.querySelectorAll ? 
                node.querySelectorAll(this.getPostSelector()) : [];
              if (posts.length > 0) {
                shouldUpdate = true;
              }
            }
          });
        }
      });
      
      if (shouldUpdate) {
        setTimeout(() => this.addFactCheckButtons(), 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Returns the CSS selector string for finding posts on the current platform.
   * Each platform uses different selectors to identify post elements.
   * 
   * @returns {string} A CSS selector string for finding posts on the current platform
   */
  getPostSelector() {
    switch (this.platform) {
      case 'twitter':
        return '[data-testid="tweet"]';
      case 'instagram':
        return 'article';
      case 'facebook':
        return '[data-pagelet="FeedUnit_0"]';
      default:
        return '';
    }
  }
}

/**
 * Initializes the SocialMediaExtractor when the DOM is ready.
 * Waits for DOMContentLoaded if the page is still loading, otherwise initializes immediately.
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SocialMediaExtractor();
  });
} else {
  new SocialMediaExtractor();
}
