// Extension popup implementation
class PopupManager {
  constructor() {
    this.apiDomain = 'https://fact-checker-website.vercel.app';
    this.siteDomain = 'https://fact-checker-website.vercel.app';
    this.token = null;
    this.limits = null;
    this.userInfo = null;
    
    this.init();
  }

  async init() {
    await this.loadToken();
    await this.loadLimits();
    this.setupEventListeners();
    this.updateUI();
  }

  setupEventListeners() {
    document.getElementById('login')?.addEventListener('click', () => this.login());
    document.getElementById('check')?.addEventListener('click', () => this.factCheck());
    document.getElementById('upgrade')?.addEventListener('click', () => this.upgrade());
    document.getElementById('logout')?.addEventListener('click', () => this.logout());
    document.getElementById('settings-link')?.addEventListener('click', () => this.openSettings());
    document.getElementById('help-link')?.addEventListener('click', () => this.openHelp());
  }

  async loadToken() {
    try {
      const result = await chrome.storage.local.get(['authToken', 'userInfo']);
      this.token = result.authToken || null;
      this.userInfo = result.userInfo || null;
    } catch (error) {
      console.error('Error loading token:', error);
    }
  }

  async saveToken(token, userInfo) {
    try {
      await chrome.storage.local.set({ 
        authToken: token,
        userInfo: userInfo
      });
      this.token = token;
      this.userInfo = userInfo;
    } catch (error) {
      console.error('Error saving token:', error);
    }
  }

  async clearToken() {
    try {
      await chrome.storage.local.remove(['authToken', 'userInfo']);
      this.token = null;
      this.userInfo = null;
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  }

  async loadLimits() {
    if (!this.token) {
      this.limits = null;
      return;
    }

    try {
      const response = await this.apiFetch('me/limits');
      this.limits = await response.json();
    } catch (error) {
      console.error('Error loading limits:', error);
      if (error instanceof Response && error.status === 401) {
        await this.clearToken();
        this.limits = null;
      }
    }
  }

  async login() {
    try {
      // Generate a unique state parameter for this login session
      const state = 'ext_login_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      // Store the state so we can verify it later
      await chrome.storage.local.set({ loginState: state });
      
      // Open the auth page in a new tab with the state parameter
      const authUrl = `${this.siteDomain}/auth?state=${state}&source=extension`;
      
      const tab = await chrome.tabs.create({ url: authUrl });
      
      this.showStatus('Please complete sign-in in the new tab...', 'warning');
      
      // Start polling for authentication completion
      this.pollForAuth(state, tab.id);
    } catch (error) {
      console.error('Login error:', error);
      this.showStatus('Login failed. Please try again.', 'error');
    }
  }

  pollForAuth(state, tabId) {
    console.log('Starting auth polling for state:', state);
    const pollInterval = setInterval(async () => {
      try {
        // Check if the tab is still open
        if (tabId) {
          try {
            await chrome.tabs.get(tabId);
          } catch (error) {
            // Tab was closed, stop polling
            clearInterval(pollInterval);
            this.showStatus('Login cancelled. Please try again.', 'warning');
            return;
          }
        }
        
        // Check if we have a token in storage (either from extension storage or website localStorage)
        const result = await chrome.storage.local.get(['authToken', 'loginState', 'userInfo']);
        console.log('Polling check - stored result:', result);
        
        // Also check if the website stored a token in localStorage
        let websiteToken = null;
        if (tabId) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                return {
                  token: localStorage.getItem('ext_auth_token'),
                  state: localStorage.getItem('ext_auth_state')
                };
              }
            });
            
            if (results && results[0] && results[0].result) {
              websiteToken = results[0].result.token;
              const websiteState = results[0].result.state;
              console.log('Website localStorage check - token:', websiteToken ? 'found' : 'not found', 'state:', websiteState, 'expected state:', state);
              
              if (websiteToken && websiteState === state) {
                console.log('Found matching token from website, storing in extension');
                // Found matching token from website
                await chrome.storage.local.set({ 
                  authToken: websiteToken,
                  userInfo: { email: 'Extension User', uid: 'ext_user' } // Basic user info for extension
                });
                // Clear website storage
                await chrome.scripting.executeScript({
                  target: { tabId },
                  func: () => {
                    localStorage.removeItem('ext_auth_token');
                    localStorage.removeItem('ext_auth_state');
                  }
                });
              }
            }
          } catch (error) {
            // Script injection might fail, that's okay
            console.log('Could not check website localStorage:', error);
          }
        }
        
        if ((result.authToken && result.loginState === state) || websiteToken) {
          // Authentication successful!
          console.log('Authentication successful! Clearing polling interval');
          clearInterval(pollInterval);
          this.showStatus('Successfully signed in!', 'success');
          await this.loadToken();
          await this.loadLimits();
          this.updateUI();
          
          // Close the auth tab if it's still open
          if (tabId) {
            try {
              await chrome.tabs.remove(tabId);
            } catch (error) {
              // Tab might already be closed, ignore
            }
          }
          
          // Clean up the login state
          await chrome.storage.local.remove(['loginState']);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000); // Poll every 2 seconds
    
    // Stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      if (tabId) {
        chrome.tabs.get(tabId).then(() => {
          this.showStatus('Login timed out. Please try again.', 'warning');
        }).catch(() => {
          // Tab was closed, that's fine
        });
      }
    }, 5 * 60 * 1000);
  }

  async factCheck() {
    const input = document.getElementById('input').value.trim();
    if (!input) {
      this.showStatus('Please enter some text to fact-check.', 'warning');
      return;
    }

    if (!this.token) {
      this.showStatus('Please sign in first.', 'warning');
      return;
    }

    const checkButton = document.getElementById('check');
    const originalText = checkButton.textContent;
    checkButton.textContent = '⏳ Checking...';
    checkButton.disabled = true;

    try {
      // Use background script for fact checking
      const response = await chrome.runtime.sendMessage({
        action: 'factCheck',
        data: {
          text: input,
          images: [],
          platform: 'extension'
        }
      });

      if (response.success) {
        // Convert background script response to our expected format
        const result = {
          result: response.results.overallRating.explanation,
          credibility: response.results.overallRating.rating / 10, // Convert 1-10 to 0-1
          sources: response.results.claims.flatMap(claim => 
            claim.sources.map(source => source.title)
          )
        };
        this.showResult(result);
        await this.loadLimits(); // Refresh limits
        this.updateUI();
      } else {
        if (response.requiresAuth) {
          this.showStatus('Please sign in to use the fact checker.', 'warning');
        } else if (response.limitReached) {
          this.showStatus(`Daily limit reached (${response.todayChecks}/${response.maxChecks}). Upgrade to Pro for unlimited checks.`, 'warning');
          this.showUpgradeButton();
        } else {
          this.showStatus(response.error || 'Fact check failed. Please try again.', 'error');
        }
      }
      
    } catch (error) {
      console.error('Fact check error:', error);
      this.showStatus('Fact check failed. Please try again.', 'error');
    } finally {
      checkButton.textContent = originalText;
      checkButton.disabled = false;
    }
  }

  async upgrade() {
    if (!this.token) {
      this.showStatus('Please sign in first.', 'warning');
      return;
    }

    try {
      // Generate a unique redirect URI for this extension instance
      const redirectUri = chrome.runtime.getURL('popup.html');
      
      // Open billing page with redirect_uri parameter
      await chrome.tabs.create({ url: `${this.siteDomain}/billing?redirect_uri=${encodeURIComponent(redirectUri)}` });
      
      // Poll for plan changes
      this.pollForPlanChanges();
    } catch (error) {
      console.error('Upgrade error:', error);
      this.showStatus('Failed to open billing page.', 'error');
    }
  }

  async pollForPlanChanges() {
    const maxAttempts = 24; // 2 minutes with 5-second intervals
    let attempts = 0;

    const poll = async () => {
      attempts++;
      try {
        await this.loadLimits();
        this.updateUI();
        
        if (this.limits?.plan === 'pro') {
          this.showStatus('Welcome to Pro! You now have unlimited fact checks.', 'success');
          return;
        }
        
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    poll();
  }

  async logout() {
    try {
      await this.clearToken();
      this.limits = null;
      this.updateUI();
      this.showStatus('Successfully signed out.', 'success');
    } catch (error) {
      console.error('Logout error:', error);
      this.showStatus('Logout failed. Please try again.', 'error');
    }
  }

  async apiFetch(endpoint, options = {}) {
    const url = `${this.apiDomain}/api/${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return fetch(url, {
      ...options,
      headers
    });
  }

  updateUI() {
    const authSection = document.getElementById('auth-section');
    const factCheckSection = document.getElementById('fact-check-section');
    const usageInfo = document.getElementById('usage-info');
    const usageInfoAuth = document.getElementById('usage-info-authenticated');
    const upgradeButton = document.getElementById('upgrade');

    if (!this.token) {
      // Not logged in
      authSection.style.display = 'block';
      factCheckSection.style.display = 'none';
      usageInfo.textContent = 'Sign in to access fact checking features';
    } else if (this.limits) {
      // Logged in with limits
      authSection.style.display = 'none';
      factCheckSection.style.display = 'block';
      
      if (this.limits.plan === 'free') {
        upgradeButton.classList.remove('hidden');
        const remaining = Math.max(0, (this.limits.limit || 5) - this.limits.used);
        usageInfoAuth.textContent = `Free • ${remaining} checks remaining today (${this.limits.used}/${this.limits.limit || 5})`;
        usageInfoAuth.className = 'usage-info';
      } else {
        upgradeButton.classList.add('hidden');
        usageInfoAuth.textContent = 'Pro • Unlimited checks';
        usageInfoAuth.className = 'usage-info pro';
      }
    } else {
      // Loading or error
      authSection.style.display = 'block';
      factCheckSection.style.display = 'none';
      usageInfo.textContent = 'Loading...';
    }
  }

  showStatus(message, type) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
      status.className = `status ${type}`;
      status.classList.remove('hidden');
      
      setTimeout(() => {
        status.classList.add('hidden');
      }, 5000);
    }
  }

  showResult(result) {
    const resultSection = document.getElementById('result-section');
    const resultContent = document.getElementById('result-content');
    
    if (resultSection && resultContent) {
      resultContent.innerHTML = `
        <div><strong>Credibility Score:</strong> ${Math.round(result.credibility * 100)}%</div>
        <div style="margin-top: 8px;"><strong>Analysis:</strong></div>
        <div style="margin-top: 4px;">${result.result}</div>
        ${result.sources.length > 0 ? `
          <div style="margin-top: 8px;"><strong>Sources:</strong></div>
          <ul style="margin-top: 4px; padding-left: 16px;">
            ${result.sources.map(source => `<li>${source}</li>`).join('')}
          </ul>
        ` : ''}
      `;
      resultSection.classList.remove('hidden');
    }
  }

  showUpgradeButton() {
    const upgradeButton = document.getElementById('upgrade');
    if (upgradeButton) {
      upgradeButton.classList.remove('hidden');
    }
  }

  openSettings() {
    // Open extension options page if available
    chrome.runtime.openOptionsPage?.() || this.showStatus('Settings not available', 'warning');
  }

  openHelp() {
    // Open help page
    chrome.tabs.create({ url: `${this.siteDomain}/help` });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});