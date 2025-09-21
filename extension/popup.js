var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// src/popup.ts
var PopupManager = class {
  constructor() {
    __publicField(this, "apiDomain");
    __publicField(this, "siteDomain");
    __publicField(this, "token", null);
    __publicField(this, "limits", null);
    this.apiDomain = "https://fact-checker-website-cfz7wxzzc-amit-s-projects-3f01818e.vercel.app/";
    this.siteDomain = "https://fact-checker-website-cfz7wxzzc-amit-s-projects-3f01818e.vercel.app/";
    this.init();
  }
  async init() {
    await this.loadToken();
    await this.loadLimits();
    this.setupEventListeners();
    this.updateUI();
  }
  setupEventListeners() {
    document.getElementById("login")?.addEventListener("click", () => this.login());
    document.getElementById("check")?.addEventListener("click", () => this.factCheck());
    document.getElementById("upgrade")?.addEventListener("click", () => this.upgrade());
  }
  async loadToken() {
    try {
      const result = await chrome.storage.local.get(["authToken"]);
      this.token = result.authToken || null;
    } catch (error) {
      console.error("Error loading token:", error);
    }
  }
  async saveToken(token) {
    try {
      await chrome.storage.local.set({ authToken: token });
      this.token = token;
    } catch (error) {
      console.error("Error saving token:", error);
    }
  }
  async clearToken() {
    try {
      await chrome.storage.local.remove(["authToken"]);
      this.token = null;
    } catch (error) {
      console.error("Error clearing token:", error);
    }
  }
  async loadLimits() {
    if (!this.token) {
      this.limits = null;
      return;
    }
    try {
      const response = await this.apiFetch("me/limits");
      this.limits = await response.json();
    } catch (error) {
      console.error("Error loading limits:", error);
      if (error instanceof Response && error.status === 401) {
        await this.clearToken();
        this.limits = null;
      }
    }
  }
  async login() {
    try {
      const state = "ext_login_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      await chrome.storage.local.set({ loginState: state });
      const authUrl = `${this.siteDomain}/auth?state=${state}&source=extension`;
      const tab = await chrome.tabs.create({ url: authUrl });
      this.showStatus("Please complete sign-in in the new tab...", "warning");
      this.pollForAuth(state, tab.id);
    } catch (error) {
      console.error("Login error:", error);
      this.showStatus("Login failed. Please try again.", "error");
    }
  }
  pollForAuth(state, tabId) {
    const pollInterval = setInterval(async () => {
      try {
        if (tabId) {
          try {
            await chrome.tabs.get(tabId);
          } catch (error) {
            clearInterval(pollInterval);
            this.showStatus("Login cancelled. Please try again.", "warning");
            return;
          }
        }
        const result = await chrome.storage.local.get(["authToken", "loginState"]);
        let websiteToken = null;
        if (tabId) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                return {
                  token: localStorage.getItem("ext_auth_token"),
                  state: localStorage.getItem("ext_auth_state")
                };
              }
            });
            if (results && results[0] && results[0].result) {
              websiteToken = results[0].result.token;
              const websiteState = results[0].result.state;
              if (websiteToken && websiteState === state) {
                await chrome.storage.local.set({ authToken: websiteToken });
                await chrome.scripting.executeScript({
                  target: { tabId },
                  func: () => {
                    localStorage.removeItem("ext_auth_token");
                    localStorage.removeItem("ext_auth_state");
                  }
                });
              }
            }
          } catch (error) {
            console.log("Could not check website localStorage:", error);
          }
        }
        if (result.authToken && result.loginState === state || websiteToken) {
          clearInterval(pollInterval);
          this.showStatus("Successfully signed in!", "success");
          await this.loadLimits();
          this.updateUI();
          if (tabId) {
            try {
              await chrome.tabs.remove(tabId);
            } catch (error) {
            }
          }
          await chrome.storage.local.remove(["loginState"]);
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 2e3);
    setTimeout(() => {
      clearInterval(pollInterval);
      if (tabId) {
        chrome.tabs.get(tabId).then(() => {
          this.showStatus("Login timed out. Please try again.", "warning");
        }).catch(() => {
        });
      }
    }, 5 * 60 * 1e3);
  }
  async factCheck() {
    const input = document.getElementById("input")?.value.trim();
    if (!input) {
      this.showStatus("Please enter some text to fact-check.", "warning");
      return;
    }
    if (!this.token) {
      this.showStatus("Please sign in first.", "warning");
      return;
    }
    const checkButton = document.getElementById("check");
    const originalText = checkButton.textContent;
    checkButton.textContent = "Checking...";
    checkButton.disabled = true;
    try {
      const response = await this.apiFetch("fact-check", {
        method: "POST",
        body: JSON.stringify({ text: input })
      });
      if (response.status === 402) {
        const error = await response.json();
        this.showStatus("Daily limit reached. Upgrade to Pro for unlimited checks.", "warning");
        this.showUpgradeButton();
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      this.showResult(result);
      await this.loadLimits();
      this.updateUI();
    } catch (error) {
      console.error("Fact check error:", error);
      this.showStatus("Fact check failed. Please try again.", "error");
    } finally {
      checkButton.textContent = originalText;
      checkButton.disabled = false;
    }
  }
  async upgrade() {
    if (!this.token) {
      this.showStatus("Please sign in first.", "warning");
      return;
    }
    try {
      const redirectUri = chrome.runtime.getURL("popup.html");
      await chrome.tabs.create({ url: `${this.siteDomain}/billing?redirect_uri=${encodeURIComponent(redirectUri)}` });
      this.pollForPlanChanges();
    } catch (error) {
      console.error("Upgrade error:", error);
      this.showStatus("Failed to open billing page.", "error");
    }
  }
  async pollForPlanChanges() {
    const maxAttempts = 24;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        await this.loadLimits();
        this.updateUI();
        if (this.limits?.plan === "pro") {
          this.showStatus("Welcome to Pro! You now have unlimited fact checks.", "success");
          return;
        }
        if (attempts < maxAttempts) {
          setTimeout(poll, 5e3);
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    };
    poll();
  }
  async apiFetch(endpoint, options = {}) {
    const url = `${this.apiDomain}/api/${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...options.headers
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return fetch(url, {
      ...options,
      headers
    });
  }
  updateUI() {
    const loginButton = document.getElementById("login");
    const checkButton = document.getElementById("check");
    const upgradeButton = document.getElementById("upgrade");
    const usageInfo = document.getElementById("usage-info");
    if (!this.token) {
      loginButton?.classList.remove("hidden");
      checkButton?.classList.add("hidden");
      upgradeButton?.classList.add("hidden");
      usageInfo.textContent = "Sign in to start fact-checking";
      usageInfo.className = "usage-info";
    } else if (this.limits) {
      loginButton?.classList.add("hidden");
      checkButton?.classList.remove("hidden");
      if (this.limits.plan === "free") {
        upgradeButton?.classList.remove("hidden");
        usageInfo.textContent = `Free \u2022 ${this.limits.used}/${this.limits.limit} checks today \u2022 Resets ${new Date(this.limits.resetsAt).toLocaleTimeString()}`;
        usageInfo.className = "usage-info";
      } else {
        upgradeButton?.classList.add("hidden");
        usageInfo.textContent = "Pro \u2022 Unlimited checks";
        usageInfo.className = "usage-info pro";
      }
    } else {
      loginButton?.classList.remove("hidden");
      checkButton?.classList.add("hidden");
      upgradeButton?.classList.add("hidden");
      usageInfo.textContent = "Loading...";
      usageInfo.className = "usage-info";
    }
  }
  showStatus(message, type) {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = message;
      status.className = `status ${type}`;
      status.classList.remove("hidden");
      setTimeout(() => {
        status.classList.add("hidden");
      }, 5e3);
    }
  }
  showResult(result) {
    const resultDiv = document.getElementById("result");
    const contentDiv = document.getElementById("result-content");
    if (resultDiv && contentDiv) {
      contentDiv.innerHTML = `
        <div><strong>Credibility Score:</strong> ${Math.round(result.credibility * 100)}%</div>
        <div style="margin-top: 8px;"><strong>Analysis:</strong></div>
        <div style="margin-top: 4px;">${result.result}</div>
        ${result.sources.length > 0 ? `
          <div style="margin-top: 8px;"><strong>Sources:</strong></div>
          <ul style="margin-top: 4px; padding-left: 16px;">
            ${result.sources.map((source) => `<li>${source}</li>`).join("")}
          </ul>
        ` : ""}
      `;
      resultDiv.classList.remove("hidden");
    }
  }
  showUpgradeButton() {
    const upgradeButton = document.getElementById("upgrade");
    if (upgradeButton) {
      upgradeButton.classList.remove("hidden");
    }
  }
};
document.addEventListener("DOMContentLoaded", () => {
  new PopupManager();
});
