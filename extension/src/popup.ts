// Extension popup implementation
interface UserLimits {
  plan: 'free' | 'pro';
  used: number;
  limit: number | null;
  resetsAt: string;
}

interface FactCheckResponse {
  result: string;
  credibility: number;
  sources: string[];
}

interface ApiError {
  error: string;
  resetsAt?: string;
}

class PopupManager {
  private apiDomain: string;
  private siteDomain: string;
  private token: string | null = null;
  private limits: UserLimits | null = null;

  constructor() {
    // These should be configured based on environment
    this.apiDomain = 'https://fact-checker-6ggdvbnyi-amit-s-projects-3f01818e.vercel.app'; // Replace with actual API domain
    this.siteDomain = 'https://fact-checker-website-pf3ao4u8a-amit-s-projects-3f01818e.vercel.app';
    
    this.init();
  }

  async init() {
    await this.loadToken();
    await this.loadLimits();
    this.setupEventListeners();
    this.updateUI();
  }

  private setupEventListeners() {
    document.getElementById('login')?.addEventListener('click', () => this.login());
    document.getElementById('check')?.addEventListener('click', () => this.factCheck());
    document.getElementById('upgrade')?.addEventListener('click', () => this.upgrade());
  }

  private async loadToken(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['authToken']);
      this.token = result.authToken || null;
    } catch (error) {
      console.error('Error loading token:', error);
    }
  }

  private async saveToken(token: string): Promise<void> {
    try {
      await chrome.storage.local.set({ authToken: token });
      this.token = token;
    } catch (error) {
      console.error('Error saving token:', error);
    }
  }

  private async clearToken(): Promise<void> {
    try {
      await chrome.storage.local.remove(['authToken']);
      this.token = null;
    } catch (error) {
      console.error('Error clearing token:', error);
    }
  }

  private async loadLimits(): Promise<void> {
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

  private async login(): Promise<void> {
    try {
      const redirectUri = chrome.identity.getRedirectURL();
      const authUrl = `${this.siteDomain}/ext/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
      
      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      });

      // Extract token from URL hash
      const url = new URL(responseUrl);
      const token = url.hash.match(/token=([^&]+)/)?.[1];
      
      if (token) {
        await this.saveToken(token);
        await this.loadLimits();
        this.updateUI();
        this.showStatus('Successfully signed in!', 'success');
      } else {
        throw new Error('No token received');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showStatus('Login failed. Please try again.', 'error');
    }
  }

  private async factCheck(): Promise<void> {
    const input = (document.getElementById('input') as HTMLTextAreaElement)?.value.trim();
    if (!input) {
      this.showStatus('Please enter some text to fact-check.', 'warning');
      return;
    }

    if (!this.token) {
      this.showStatus('Please sign in first.', 'warning');
      return;
    }

    const checkButton = document.getElementById('check') as HTMLButtonElement;
    const originalText = checkButton.textContent;
    checkButton.textContent = 'Checking...';
    checkButton.disabled = true;

    try {
      const response = await this.apiFetch('fact-check', {
        method: 'POST',
        body: JSON.stringify({ text: input })
      });

      if (response.status === 402) {
        const error: ApiError = await response.json();
        this.showStatus('Daily limit reached. Upgrade to Pro for unlimited checks.', 'warning');
        this.showUpgradeButton();
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result: FactCheckResponse = await response.json();
      this.showResult(result);
      await this.loadLimits(); // Refresh limits
      this.updateUI();
      
    } catch (error) {
      console.error('Fact check error:', error);
      this.showStatus('Fact check failed. Please try again.', 'error');
    } finally {
      checkButton.textContent = originalText;
      checkButton.disabled = false;
    }
  }

  private async upgrade(): Promise<void> {
    if (!this.token) {
      this.showStatus('Please sign in first.', 'warning');
      return;
    }

    try {
      // Open billing page
      await chrome.tabs.create({ url: `${this.siteDomain}/billing` });
      
      // Poll for plan changes
      this.pollForPlanChanges();
    } catch (error) {
      console.error('Upgrade error:', error);
      this.showStatus('Failed to open billing page.', 'error');
    }
  }

  private async pollForPlanChanges(): Promise<void> {
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

  private async apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
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

  private updateUI(): void {
    const loginButton = document.getElementById('login');
    const checkButton = document.getElementById('check');
    const upgradeButton = document.getElementById('upgrade');
    const usageInfo = document.getElementById('usage-info');

    if (!this.token) {
      // Not logged in
      loginButton?.classList.remove('hidden');
      checkButton?.classList.add('hidden');
      upgradeButton?.classList.add('hidden');
      usageInfo!.textContent = 'Sign in to start fact-checking';
      usageInfo!.className = 'usage-info';
    } else if (this.limits) {
      // Logged in with limits
      loginButton?.classList.add('hidden');
      checkButton?.classList.remove('hidden');
      
      if (this.limits.plan === 'free') {
        upgradeButton?.classList.remove('hidden');
        usageInfo!.textContent = `Free • ${this.limits.used}/${this.limits.limit} checks today • Resets ${new Date(this.limits.resetsAt).toLocaleTimeString()}`;
        usageInfo!.className = 'usage-info';
      } else {
        upgradeButton?.classList.add('hidden');
        usageInfo!.textContent = 'Pro • Unlimited checks';
        usageInfo!.className = 'usage-info pro';
      }
    } else {
      // Loading or error
      loginButton?.classList.remove('hidden');
      checkButton?.classList.add('hidden');
      upgradeButton?.classList.add('hidden');
      usageInfo!.textContent = 'Loading...';
      usageInfo!.className = 'usage-info';
    }
  }

  private showStatus(message: string, type: 'success' | 'error' | 'warning'): void {
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

  private showResult(result: FactCheckResponse): void {
    const resultDiv = document.getElementById('result');
    const contentDiv = document.getElementById('result-content');
    
    if (resultDiv && contentDiv) {
      contentDiv.innerHTML = `
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
      resultDiv.classList.remove('hidden');
    }
  }

  private showUpgradeButton(): void {
    const upgradeButton = document.getElementById('upgrade');
    if (upgradeButton) {
      upgradeButton.classList.remove('hidden');
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
