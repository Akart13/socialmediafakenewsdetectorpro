// Content script for extracting text from social media posts
class SocialMediaExtractor {
  constructor() {
    this.platform = this.detectPlatform();
    this.imageExtractor = new ImageTextExtractor();
    this.init();
  }

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

  init() {
    this.checkExtensionValidity();
    this.addFactCheckButtons();
    this.observePageChanges();
  }

  checkExtensionValidity() {
    // Check if the extension context is still valid
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      console.warn('Extension context invalidated - extension may need to be reloaded');
      return;
    }

    // Send a ping to the background script to verify connectivity
    chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Extension context invalidated:', chrome.runtime.lastError.message);
      }
    });
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['showImages', 'autoCheck', 'fastMode'], (result) => {
        resolve({
          showImages: result.showImages !== false, // Default to true
          autoCheck: result.autoCheck || false,
          fastMode: result.fastMode || false
        });
      });
    });
  }

  addFactCheckButtons() {
    // Add buttons to existing posts
    this.addButtonsToPosts();
  }

  addButtonsToPosts() {
    const posts = this.getPosts();
    posts.forEach(post => {
      if (!post.querySelector('.fact-check-btn')) {
        this.addButtonToPost(post);
      }
    });
  }

  getPosts() {
    switch (this.platform) {
      case 'twitter':
        return Array.from(document.querySelectorAll('[data-testid="tweet"]'));
      case 'instagram':
        return Array.from(document.querySelectorAll('article'));
      case 'facebook':
        return Array.from(document.querySelectorAll('[data-pagelet="FeedUnit_0"]'));
      default:
        return [];
    }
  }

  addButtonToPost(post) {
    const button = document.createElement('button');
    button.className = 'fact-check-btn';
    button.innerHTML = '🔍 Fact Check';
    button.style.cssText = `
      background: #1da1f2;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: bold;
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

  getButtonContainer(post) {
    switch (this.platform) {
      case 'twitter':
        return post.querySelector('[role="group"]');
      case 'instagram':
        return post.querySelector('header');
      case 'facebook':
        return post.querySelector('[data-testid="post_message"]')?.parentElement;
      default:
        return post;
    }
  }

  async factCheckPost(post) {
    const button = post.querySelector('.fact-check-btn');
    if (button) {
      button.innerHTML = '⏳ Checking...';
      button.disabled = true;
    }

    try {
      const postData = await this.extractPostData(post);
      const result = await this.sendFactCheckRequest(postData);
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

  async extractPostData(post) {
    if (!post || !post.nodeType) {
      throw new Error('Invalid post element provided');
    }
    
    const text = this.extractText(post);
    const images = this.extractImages(post);
    
    // Extract text from images if any (and if enabled)
    let imageTexts = [];
    if (images && images.length > 0) {
      try {
        // Check if image processing is enabled
        const settings = await this.getSettings();
        if (settings.showImages !== false && !settings.fastMode) {
          imageTexts = await this.imageExtractor.extractTextFromImages(images);
        }
      } catch (error) {
        console.warn('Failed to extract text from images:', error);
        imageTexts = [];
      }
    }
    
    // Combine all text content safely
    const allText = [
      text || '',
      ...(imageTexts || []).map(img => img?.extractedText || '').filter(t => t && t.trim())
    ].filter(t => t && t.trim()).join(' ');
    
    // Validate that we have some text to analyze
    if (!allText || allText.trim().length === 0) {
      throw new Error('No text content found in the post');
    }
    
    return {
      text: allText,
      originalText: text || '',
      images: images || [],
      imageTexts: imageTexts || [],
      platform: this.platform,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
  }

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

  extractImages(post) {
    const images = [];
    const imgElements = post.querySelectorAll('img');
    
    imgElements.forEach(img => {
      if (img.src && !img.src.includes('profile') && !img.src.includes('avatar')) {
        images.push({
          src: img.src,
          alt: img.alt || ''
        });
      }
    });
    
    return images;
  }

  async sendFactCheckRequest(data) {
    return new Promise((resolve, reject) => {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension context invalidated. Please refresh the page.'));
        return;
      }

      chrome.runtime.sendMessage({
        action: 'factCheck',
        data: data
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

  displayResults(post, results) {
    // Remove existing results
    const existingResults = post.querySelector('.fact-check-results');
    if (existingResults) {
      existingResults.remove();
    }

    // Create and show interactive overlay
    this.showInteractiveOverlay(results);
  }

  showInteractiveOverlay(results) {
    // Remove any existing overlay
    const existingOverlay = document.querySelector('.fact-check-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'fact-check-overlay';
    
    // Build the results HTML
    let resultsHTML = `
      <div class="fact-check-modal">
        <div class="fact-check-header">
          <div class="fact-check-title">
            🔍 Fact Check Results
          </div>
          <button class="fact-check-close" data-close="true">×</button>
        </div>
        <div class="fact-check-content">
          <div class="overall-rating">
            <div class="rating-score">
              ${Math.round(results.overallRating.rating * 10)}%
            </div>
            <div class="rating-label">${results.overallRating.assessment}</div>
            <div class="rating-explanation">
              ${results.overallRating.explanation}
            </div>
          </div>
    `;

    // Add individual claims if available
    if (results.claims && results.claims.length > 0) {
      resultsHTML += `
        <div class="claims-section">
          <h3>Individual Claims Analysis</h3>
      `;
      
      results.claims.forEach((claim, index) => {
        resultsHTML += `
          <div class="claim-item">
            <div class="claim-text">${claim.claim}</div>
            <div class="claim-rating">
              <span class="claim-score">${Math.round(claim.credibilityRating.rating * 10)}%</span>
              <span class="claim-confidence">Confidence: ${Math.round(claim.credibilityRating.confidence * 100)}%</span>
            </div>
            <div class="claim-explanation">${claim.credibilityRating.explanation}</div>
        `;
        
        // Add sources if available
        if (claim.sources && claim.sources.length > 0) {
          resultsHTML += `
            <div class="sources">
              <h4>Sources:</h4>
              <ul>
          `;
          claim.sources.forEach(source => {
            resultsHTML += `
              <li>
                <a href="${source.url}" target="_blank" rel="noopener noreferrer">
                  ${source.title}
                </a>
                <span class="source-scores">
                  (Credibility: ${source.credibilityScore}/10, Relevance: ${source.relevanceScore}/10)
                </span>
                <div class="source-summary">${source.summary}</div>
              </li>
            `;
          });
          resultsHTML += `
              </ul>
            </div>
          `;
        }
        
        resultsHTML += `
          </div>
        `;
      });
      
      resultsHTML += `
        </div>
      `;
    }

    resultsHTML += `
        </div>
      </div>
    `;

    overlay.innerHTML = resultsHTML;
    document.body.appendChild(overlay);

    // Add event listeners for interactive elements
    this.addOverlayEventListeners(overlay);
  }

  addOverlayEventListeners(overlay) {
    // Close button
    const closeBtn = overlay.querySelector('.fact-check-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        overlay.remove();
      });
    }

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    // Escape key to close
    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleKeyPress);
      }
    };
    document.addEventListener('keydown', handleKeyPress);
  }

  showError(post, message) {
    // Remove any existing overlay
    const existingOverlay = document.querySelector('.fact-check-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Special handling for context invalidation errors
    const isContextError = message.includes('Extension context invalidated');
    const isAuthError = message.includes('Please sign in') || message.includes('authentication');
    const isLimitError = message.includes('Daily limit reached') || message.includes('limit reached');
    
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
    } else if (isAuthError) {
      overlay.innerHTML = `
        <div class="fact-check-modal">
          <div class="fact-check-header">
            <div class="fact-check-title">
              🔐 Sign In Required
            </div>
            <button class="fact-check-close" data-close="true">×</button>
          </div>
          <div class="fact-check-content">
            <div class="fact-check-error auth-required">
              <h4>Please sign in to use the fact checker</h4>
              <p>You need to sign in to your account to use the fact checking feature.</p>
              <p>Click the extension icon in your browser toolbar to sign in.</p>
            </div>
          </div>
        </div>
      `;
    } else if (isLimitError) {
      overlay.innerHTML = `
        <div class="fact-check-modal">
          <div class="fact-check-header">
            <div class="fact-check-title">
              📊 Daily Limit Reached
            </div>
            <button class="fact-check-close" data-close="true">×</button>
          </div>
          <div class="fact-check-content">
            <div class="fact-check-error limit-reached">
              <h4>Daily fact check limit reached</h4>
              <p>You've used all your free daily fact checks.</p>
              <p>Upgrade to Pro for unlimited fact checks!</p>
              <button class="upgrade-btn" onclick="chrome.runtime.openOptionsPage()">Upgrade to Pro</button>
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
    this.addOverlayEventListeners(overlay);
  }

  observePageChanges() {
    // Use MutationObserver to detect new posts
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is a new post
              const posts = this.getPosts();
              posts.forEach(post => {
                if (!post.querySelector('.fact-check-btn')) {
                  this.addButtonToPost(post);
                }
              });
            }
          });
        }
      });
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Image text extraction class
class ImageTextExtractor {
  async extractTextFromImages(images) {
    const results = [];
    
    for (const image of images) {
      try {
        const text = await this.extractTextFromImage(image);
        if (text) {
          results.push({
            src: image.src,
            extractedText: text
          });
        }
      } catch (error) {
        console.warn('Failed to extract text from image:', error);
      }
    }
    
    return results;
  }

  async extractTextFromImage(image) {
    return new Promise((resolve, reject) => {
      // Create a canvas to process the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          // Set canvas dimensions
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Draw image to canvas
          ctx.drawImage(img, 0, 0);
          
          // For now, we'll just return a placeholder
          // In a real implementation, you'd use OCR or AI vision
          resolve('Image text extraction not implemented in this demo');
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = image.src;
    });
  }
}

// Initialize the extension when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SocialMediaExtractor();
  });
} else {
  new SocialMediaExtractor();
}