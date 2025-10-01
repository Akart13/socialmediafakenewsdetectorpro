// Popup script for the fact checker extension
class PopupManager {
  constructor() {
    this.init();
  }

  async init() {
    await this.loadUserStatus();
    await this.loadStats();
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Sign in button
    const signInBtn = document.getElementById('signInBtn');
    if (signInBtn) {
      signInBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://fact-checker-website.vercel.app/login?from=extension' });
      });
    }

    // Upgrade button
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://fact-checker-website.vercel.app/billing' });
      });
    }
  }

  async loadUserStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getUserStatus' });
      if (response.success && response.user) {
        this.updateUserUI(response.user);
      } else {
        this.showSignInUI();
      }
    } catch (error) {
      console.error('Error loading user status:', error);
      this.showSignInUI();
    }
  }

  updateUserUI(user) {
    // Hide sign-in UI
    const signInSection = document.getElementById('signInSection');
    if (signInSection) {
      signInSection.style.display = 'none';
    }

    // Show user info
    const userSection = document.getElementById('userSection');
    if (userSection) {
      userSection.style.display = 'block';
    }

    // Update user info
    const userEmail = document.getElementById('userEmail');
    if (userEmail) {
      userEmail.textContent = user.email;
    }

    const userPlan = document.getElementById('userPlan');
    if (userPlan) {
      userPlan.textContent = user.plan === 'pro' ? 'Pro' : 'Free';
      userPlan.className = user.plan === 'pro' ? 'plan-badge pro' : 'plan-badge free';
    }

    // Update quota info
    const quotaInfo = document.getElementById('quotaInfo');
    if (quotaInfo) {
      if (user.plan === 'pro' && user.subscriptionStatus === 'active') {
        quotaInfo.innerHTML = '<span class="quota-unlimited">Unlimited fact checks</span>';
      } else {
        const remaining = user.remaining || 0;
        quotaInfo.innerHTML = `<span class="quota-remaining">${remaining} checks remaining today</span>`;
      }
    }

    // Show/hide upgrade button
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.style.display = (user.plan === 'pro' && user.subscriptionStatus === 'active') ? 'none' : 'block';
    }
  }

  showSignInUI() {
    // Hide user section
    const userSection = document.getElementById('userSection');
    if (userSection) {
      userSection.style.display = 'none';
    }

    // Show sign-in section
    const signInSection = document.getElementById('signInSection');
    if (signInSection) {
      signInSection.style.display = 'block';
    }
  }


  async loadStats() {
    try {
      const result = await chrome.storage.local.get(['stats']);
      const stats = result.stats || { totalChecks: 0, todayChecks: 0, lastCheckDate: null };

      // Update today's count if it's a new day
      const today = new Date().toDateString();
      if (stats.lastCheckDate !== today) {
        stats.todayChecks = 0;
        stats.lastCheckDate = today;
        await chrome.storage.local.set({ stats });
      }

      document.getElementById('totalChecks').textContent = stats.totalChecks;
      document.getElementById('todayChecks').textContent = stats.todayChecks;
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  showStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.classList.remove('hidden');

    // Hide status after 3 seconds
    setTimeout(() => {
      statusElement.classList.add('hidden');
    }, 3000);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
