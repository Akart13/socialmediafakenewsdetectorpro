// Popup script for the fact checker extension
class PopupManager {
  /**
   * Initializes the PopupManager by calling the init method.
   */
  constructor() {
    this.init();
  }

  /**
   * Initializes the popup interface by loading user status, statistics, and setting up event listeners.
   */
  async init() {
    await this.loadUserStatus();
    await this.loadStats();
    this.setupEventListeners();
  }

  /**
   * Sets up click event listeners for sign in and upgrade buttons in the popup.
   * Opens new tabs with appropriate URLs when buttons are clicked.
   */
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

  /**
   * Loads the current user's authentication status from the background script.
   * Updates the UI to show user information if signed in, or shows sign in UI if not.
   */
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

  /**
   * Updates the popup UI to display the signed-in user's information including email,
   * plan type, and remaining quota. Hides the sign in section and shows the user section.
   * 
   * @param {Object} user - User object containing email, plan, and remaining quota information
   */
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
      if (user.plan === 'pro') {
        quotaInfo.innerHTML = '<span class="quota-unlimited">Unlimited fact checks</span>';
      } else {
        const remaining = user.remaining || 0;
        quotaInfo.innerHTML = `<span class="quota-remaining">${remaining} checks remaining today</span>`;
      }
    }

    // Show/hide upgrade button
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.style.display = user.plan === 'pro' ? 'none' : 'block';
    }
  }

  /**
   * Shows the sign in UI by hiding the user section and displaying the sign in section.
   * Called when the user is not authenticated or authentication fails.
   */
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

  /**
   * Loads and displays fact check statistics from local storage.
   * Shows total checks performed and checks performed today, resetting daily count when date changes.
   */
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

  /**
   * Displays a status message in the popup with appropriate styling based on type.
   * Messages automatically hide after 3 seconds.
   * 
   * @param {string} message - The status message text to display
   * @param {string} type - The type of message ('success' or 'error') for styling
   */
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

/**
 * Initializes the PopupManager when the popup DOM is fully loaded.
 * This ensures all DOM elements are available before attempting to interact with them.
 */
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
