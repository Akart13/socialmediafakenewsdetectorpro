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
    // Add fact-check buttons to posts
    const posts = this.getPosts();
    posts.forEach(post => {
      if (!post.querySelector('.fact-check-btn')) {
        this.addFactCheckButton(post);
      }
    });
  }

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
    
    // Overall rating
    const overallRating = results.overallRating;
    const ratingClass = overallRating.rating >= 7 ? 'rating-high' : 
                       overallRating.rating >= 4 ? 'rating-medium' : 'rating-low';
    
    // Build claims HTML
    let claimsHtml = '';
    if (results.claims && results.claims.length > 0) {
      claimsHtml = results.claims.map((claim, index) => {
        const claimRating = claim.credibilityRating;
        const claimRatingClass = claimRating.rating >= 7 ? 'rating-high' : 
                                claimRating.rating >= 4 ? 'rating-medium' : 'rating-low';
        
        let sourcesHtml = '';
        if (claim.sources && claim.sources.length > 0) {
          sourcesHtml = `
            <div class="claim-sources">
              <div class="sources-title">
                📚 Sources (${claim.sources.length})
              </div>
              ${claim.sources.map(source => `
                <div class="source-item" onclick="window.open('${source.url}', '_blank')" title="Click to open source">
                  <div class="source-header">
                    <a href="${source.url}" target="_blank" rel="noopener" class="source-title-link" onclick="event.stopPropagation()">
                      <div class="source-title">${source.title}</div>
                    </a>
                    <div class="source-scores">
                      <div class="source-score">
                        <span>📊</span>
                        <span>${source.credibilityScore}/10</span>
                      </div>
                      <div class="source-score">
                        <span>🎯</span>
                        <span>${source.relevanceScore}/10</span>
                      </div>
                    </div>
                  </div>
                  <div class="source-url-container">
                    <a href="${source.url}" target="_blank" rel="noopener" class="source-url" title="Click to open full URL" onclick="event.stopPropagation()">${source.url}</a>
                    <span class="source-link-indicator">🔗</span>
                  </div>
                  ${source.summary ? `<div class="source-summary">${source.summary}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `;
        }
        
        return `
          <div class="claim-item" data-claim-index="${index}">
            <div class="claim-header" data-expandable="true">
              <div class="claim-text">${claim.claim}</div>
              <div class="claim-rating-badge ${claimRatingClass}">
                ${claimRating.rating}/10
              </div>
              <div class="claim-expand-icon">▼</div>
            </div>
            <div class="claim-content">
              <div class="claim-explanation">
                <strong>Assessment:</strong> ${claimRating.explanation}
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
                ${overallRating.rating}/10 - ${overallRating.assessment}
              </div>
            </div>
            <div class="overall-rating-details">
              <div class="rating-metric">
                <div class="rating-metric-value">${overallRating.rating}</div>
                <div class="rating-metric-label">Credibility Score</div>
              </div>
              <div class="rating-metric">
                <div class="rating-metric-value">${Math.round(overallRating.confidence * 100)}%</div>
                <div class="rating-metric-label">Confidence</div>
              </div>
            </div>
            <div class="overall-explanation">
              ${overallRating.explanation}
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

  getRatingColor(rating) {
    if (rating >= 7) {
      return { background: '#d4edda', border: '#28a745', text: '#155724' };
    } else if (rating <= 3) {
      return { background: '#f8d7da', border: '#dc3545', text: '#721c24' };
    } else {
      return { background: '#fff3cd', border: '#ffc107', text: '#856404' };
    }
  }

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

// Initialize the extractor when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SocialMediaExtractor();
  });
} else {
  new SocialMediaExtractor();
}
