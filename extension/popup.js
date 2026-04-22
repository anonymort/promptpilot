import { createApiError, shouldClearStoredToken } from "./popup-logic.js";

const DRAFT_STORAGE_KEY = "promptDraft";
const DEFAULT_API_BASE = "https://promptpilot-api.promptpilot.workers.dev";
const LEGACY_API_BASES = new Set([
  "http://127.0.0.1:8787",
  "http://localhost:8787"
]);

const state = {
  apiBase: "",
  token: "",
  currentUser: null,
  currentTab: null,
  buyMeACoffeeUrl: "",
  listenersBound: false,
  targetFrameId: null,
  busy: new Set(),
  apiBaseStatusTimer: null
};

const els = {
  authBadge: document.getElementById("authBadge"),
  apiBase: document.getElementById("apiBase"),
  saveApiBaseBtn: document.getElementById("saveApiBaseBtn"),
  apiBaseStatus: document.getElementById("apiBaseStatus"),
  workflowHint: document.getElementById("workflowHint"),
  showLoginBtn: document.getElementById("showLoginBtn"),
  showRegisterBtn: document.getElementById("showRegisterBtn"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  authSection: document.getElementById("authSection"),
  accountSection: document.getElementById("accountSection"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  registerEmail: document.getElementById("registerEmail"),
  registerPassword: document.getElementById("registerPassword"),
  loginSubmitBtn: document.getElementById("loginSubmitBtn"),
  registerSubmitBtn: document.getElementById("registerSubmitBtn"),
  accountEmail: document.getElementById("accountEmail"),
  accountPlan: document.getElementById("accountPlan"),
  accountUsage: document.getElementById("accountUsage"),
  supporterCard: document.getElementById("supporterCard"),
  supporterCardLabel: document.getElementById("supporterCardLabel"),
  supporterCardCopy: document.getElementById("supporterCardCopy"),
  supporterLinkBtn: document.getElementById("supporterLinkBtn"),
  redeemCode: document.getElementById("redeemCode"),
  redeemBtn: document.getElementById("redeemBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  currentSite: document.getElementById("currentSite"),
  mode: document.getElementById("mode"),
  readBtn: document.getElementById("readBtn"),
  enhanceBtn: document.getElementById("enhanceBtn"),
  copyBtn: document.getElementById("copyBtn"),
  insertBtn: document.getElementById("insertBtn"),
  sourcePrompt: document.getElementById("sourcePrompt"),
  enhancedPrompt: document.getElementById("enhancedPrompt"),
  status: document.getElementById("status")
};

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function validationMessageFor(form) {
  const firstInvalid = form.querySelector(":invalid");
  if (!firstInvalid) return "";
  return firstInvalid.validationMessage || "Please complete the required fields.";
}

function setAuthView(isSignedIn) {
  els.authSection.classList.toggle("hidden", isSignedIn);
  els.accountSection.classList.toggle("hidden", !isSignedIn);
  els.authBadge.textContent = isSignedIn ? "Signed in" : "Signed out";
  els.authBadge.className = isSignedIn ? "badge badge--ok" : "badge badge--muted";
  updateUiState();
}

function formatUsage(usage) {
  if (!usage || typeof usage !== "object") return "—";
  if (usage.isUnlimited) return "Unlimited";
  if (typeof usage.used !== "number" || typeof usage.limit !== "number") return "—";
  if (usage.window === "day") return `${usage.used} / ${usage.limit} today`;
  if (usage.window === "month") return `${usage.used} / ${usage.limit} this month`;
  return `${usage.used} / ${usage.limit}`;
}

function formatPlan(plan, planExpiresAt) {
  if (!plan) return "—";
  if (plan === "supporter") return "Supporter (unlimited)";
  if (planExpiresAt) {
    return `${plan} until ${new Date(planExpiresAt).toLocaleDateString()}`;
  }
  return plan;
}

function showLogin() {
  els.loginForm.classList.remove("hidden");
  els.registerForm.classList.add("hidden");
  els.showLoginBtn.classList.add("is-active");
  els.showRegisterBtn.classList.remove("is-active");
}

function showRegister() {
  els.loginForm.classList.add("hidden");
  els.registerForm.classList.remove("hidden");
  els.showLoginBtn.classList.remove("is-active");
  els.showRegisterBtn.classList.add("is-active");
}

async function saveLocal(partial) {
  await chrome.storage.local.set(partial);
}

async function loadLocal(keys) {
  return await chrome.storage.local.get(keys);
}

async function saveDraft() {
  await saveLocal({
    [DRAFT_STORAGE_KEY]: {
      mode: els.mode.value,
      sourcePrompt: els.sourcePrompt.value,
      enhancedPrompt: els.enhancedPrompt.value,
      targetFrameId: state.targetFrameId,
      updatedAt: Date.now()
    }
  });
}

function restoreDraft(draft) {
  if (!draft || typeof draft !== "object") return;
  if (typeof draft.mode === "string" && draft.mode) {
    els.mode.value = draft.mode;
  }
  if (typeof draft.sourcePrompt === "string") {
    els.sourcePrompt.value = draft.sourcePrompt;
  }
  if (typeof draft.enhancedPrompt === "string") {
    els.enhancedPrompt.value = draft.enhancedPrompt;
  }
  if (typeof draft.targetFrameId === "number") {
    state.targetFrameId = draft.targetFrameId;
  }
}

function apiUrl(path) {
  return `${state.apiBase.replace(/\/$/, "")}${path}`;
}

async function apiFetch(path, options = {}) {
  if (!state.apiBase) throw new Error("Set the API base URL first.");

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers
    });
  } catch {
    throw createApiError("Could not reach the backend.", 0);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw createApiError(
      json.error || `Request failed with status ${response.status}`,
      response.status
    );
  }
  return json;
}

function isSupportedTab(tab = state.currentTab) {
  return Boolean(tab?.id && /^https?:\/\//i.test(tab.url || ""));
}

function describeCurrentSite(tab = state.currentTab) {
  if (!tab?.url) return "No active tab";

  try {
    const url = new URL(tab.url);
    if (/^https?:$/i.test(url.protocol)) {
      return url.hostname || "Current site";
    }
    if (url.protocol === "chrome:") return "Chrome page";
    if (url.protocol === "edge:") return "Browser page";
    return "Unsupported tab";
  } catch {
    return "Tab unavailable";
  }
}

function currentSiteKey() {
  if (!state.currentTab?.url) return "manual";

  try {
    const url = new URL(state.currentTab.url);
    if (!/^https?:$/i.test(url.protocol)) return "manual";
    return (url.hostname || "manual").replace(/^www\./, "");
  } catch {
    return "manual";
  }
}

function setBusy(key, isActive) {
  if (isActive) {
    state.busy.add(key);
  } else {
    state.busy.delete(key);
  }
  updateUiState();
}

function isBusy(key) {
  return state.busy.has(key);
}

async function withBusy(key, fn) {
  setBusy(key, true);
  try {
    return await fn();
  } finally {
    setBusy(key, false);
  }
}

function flashApiBaseStatus(message) {
  els.apiBaseStatus.textContent = message;
  if (state.apiBaseStatusTimer) {
    window.clearTimeout(state.apiBaseStatusTimer);
  }
  state.apiBaseStatusTimer = window.setTimeout(() => {
    els.apiBaseStatus.textContent = "";
    state.apiBaseStatusTimer = null;
  }, 1500);
}

function updateButtonLabels() {
  els.readBtn.textContent = isBusy("read") ? "Reading..." : "1. Read from page";
  els.enhanceBtn.textContent = isBusy("enhance") ? "Enhancing..." : "2. Enhance";
  els.copyBtn.textContent = isBusy("copy") ? "Copying..." : "Copy result";
  els.insertBtn.textContent = isBusy("insert") ? "Inserting..." : "3. Insert into page";
  els.loginSubmitBtn.textContent = isBusy("login") ? "Logging in..." : "Log in";
  els.registerSubmitBtn.textContent = isBusy("register") ? "Creating account..." : "Create account";
  els.redeemBtn.textContent = isBusy("redeem") ? "Redeeming..." : "Redeem";
  els.logoutBtn.textContent = isBusy("logout") ? "Logging out..." : "Logout";
  els.saveApiBaseBtn.textContent = isBusy("saveApiBase") ? "Saving..." : "Save";
}

function updateWorkflowHint({
  hasSavedApiBase,
  hasSource,
  hasEnhanced,
  hasEditableTab,
  hasToken
}) {
  if (!hasSavedApiBase) {
    els.workflowHint.textContent = "Add an API base URL in Connection settings to enable sign-in and enhancement.";
    return;
  }

  if (!hasEditableTab) {
    els.workflowHint.textContent = "You can still paste and enhance a prompt here, but switch to a regular website tab to read from or insert into the page.";
    return;
  }

  if (!hasToken) {
    els.workflowHint.textContent = "Capture or paste a prompt now, then sign in below to unlock enhancement.";
    return;
  }

  if (!hasSource) {
    els.workflowHint.textContent = "Read the active field or paste a prompt to start.";
    return;
  }

  if (!hasEnhanced) {
    els.workflowHint.textContent = "Run an enhancement, then review the result before you copy or insert it.";
    return;
  }

  els.workflowHint.textContent = "Your enhanced prompt is ready to copy or send back into the page.";
}

function updateUiState() {
  const hasSavedApiBase = Boolean(state.apiBase);
  const hasEditableTab = isSupportedTab();
  const hasSource = Boolean(els.sourcePrompt.value.trim());
  const hasEnhanced = Boolean(els.enhancedPrompt.value.trim());
  const hasRedeemCode = Boolean(els.redeemCode.value.trim());
  const hasToken = Boolean(state.token);
  const hasSupporterLink = Boolean(state.buyMeACoffeeUrl);
  const isSupporter = state.currentUser?.plan === "supporter";
  const apiBaseInput = els.apiBase.value.trim();
  const canSaveApiBase = Boolean(apiBaseInput) &&
    els.apiBase.checkValidity() &&
    apiBaseInput !== state.apiBase;

  updateButtonLabels();

  els.readBtn.disabled = !hasEditableTab || isBusy("read");
  els.enhanceBtn.disabled = !hasSavedApiBase || !hasToken || !hasSource || isBusy("enhance");
  els.copyBtn.disabled = !hasEnhanced || isBusy("copy");
  els.insertBtn.disabled = !hasEditableTab || !hasEnhanced || isBusy("insert");
  els.loginSubmitBtn.disabled = !hasSavedApiBase || isBusy("login");
  els.registerSubmitBtn.disabled = !hasSavedApiBase || isBusy("register");
  els.redeemBtn.disabled = !hasRedeemCode || isBusy("redeem");
  els.logoutBtn.disabled = isBusy("logout");
  els.saveApiBaseBtn.disabled = !canSaveApiBase || isBusy("saveApiBase");
  els.supporterCard.classList.toggle("hidden", !hasToken || !hasSupporterLink);
  els.supporterCard.classList.toggle("supporter-card--active", isSupporter);
  els.supporterCardLabel.textContent = isSupporter ? "Supporter unlocked" : "Unlimited";
  els.supporterCardCopy.textContent = isSupporter
    ? "Thank you for your support. Unlimited usage is now unlocked on this account."
    : "Donate on Buy Me a Coffee using this same email to unlock unlimited usage automatically.";
  els.supporterLinkBtn.textContent = isSupporter ? "View page" : "Buy unlimited";
  els.supporterLinkBtn.disabled = !hasSupporterLink;

  updateWorkflowHint({
    hasSavedApiBase,
    hasSource,
    hasEnhanced,
    hasEditableTab,
    hasToken
  });
}

async function refreshCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTab = tab || null;
    els.currentSite.textContent = describeCurrentSite(state.currentTab);
  } catch {
    state.currentTab = null;
    els.currentSite.textContent = "Tab unavailable";
  }
  updateUiState();
}

async function refreshMe() {
  if (!state.token || !state.apiBase) {
    state.currentUser = null;
    state.buyMeACoffeeUrl = "";
    setAuthView(false);
    return;
  }

  try {
    const data = await apiFetch("/api/me", { method: "GET" });
    state.currentUser = data.user;
    state.buyMeACoffeeUrl = data.billing?.buyMeACoffeeUrl || "";
    setAuthView(true);
    els.accountEmail.textContent = data.user.email;
    els.accountPlan.textContent = formatPlan(data.user.plan, data.user.planExpiresAt);
    els.accountUsage.textContent = formatUsage(data.usage);
  } catch (error) {
    if (shouldClearStoredToken(error)) {
      state.currentUser = null;
      state.token = "";
      state.buyMeACoffeeUrl = "";
      await saveLocal({ token: "" });
      setAuthView(false);
      setStatus("Session expired. Log in again.", "neutral");
      return;
    }
    console.warn(error);
    setStatus(error.message || "Could not refresh account.", "error");
  }
  updateUiState();
}

async function injectAndRun(func, args = [], options = {}) {
  if (!state.currentTab?.id) throw new Error("No active tab.");
  const target = { tabId: state.currentTab.id };
  if (Array.isArray(options.frameIds) && options.frameIds.length > 0) {
    target.frameIds = options.frameIds;
  } else if (options.allFrames) {
    target.allFrames = true;
  }

  const results = await chrome.scripting.executeScript({
    target,
    func,
    args
  });
  return results || [];
}

function pageReadFocusedField() {
  const marker = "data-promptpilot-target";
  const preferredSelectors = [
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='plaintext-only'][role='textbox']",
    ".ProseMirror[contenteditable='true']",
    "textarea",
    "input[type='text']",
    "input[type='search']",
    "input[type='url']",
    "input[type='email']"
  ];
  const fallbackSelectors = [
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "[role='textbox']"
  ];

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const isEditable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email"].includes(type);
    }
    return el.isContentEditable;
  };

  const nearestEditable = (node) => {
    let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && current !== document.documentElement) {
      if (isEditable(current) && isVisible(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const fromSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    return nearestEditable(selection.anchorNode);
  };

  const candidateScore = (el) => {
    let score = 0;
    const rect = el.getBoundingClientRect();
    const active = document.activeElement;
    const selectionTarget = fromSelection();

    if (el === active || el.contains(active)) score += 100;
    if (selectionTarget && (el === selectionTarget || el.contains(selectionTarget))) score += 90;
    if (el.classList.contains("ProseMirror")) score += 50;
    if ((el.getAttribute("role") || "").toLowerCase() === "textbox") score += 30;
    if (el.isContentEditable) score += 20;
    if (
      el.getAttribute("placeholder") ||
      el.getAttribute("data-placeholder") ||
      el.getAttribute("aria-placeholder")
    ) {
      score += 10;
    }
    score += Math.min(20, Math.round((rect.width * rect.height) / 40000));
    return score;
  };

  const allRoots = () => {
    const roots = [document];
    const elements = document.querySelectorAll("*");
    for (const el of elements) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return roots;
  };

  const collectCandidates = () => {
    const found = [];
    const seen = new Set();
    const roots = allRoots();

    for (const root of roots) {
      for (const selector of preferredSelectors.concat(fallbackSelectors)) {
        for (const el of root.querySelectorAll(selector)) {
          if (!isEditable(el) || !isVisible(el) || seen.has(el)) continue;
          seen.add(el);
          found.push(el);
        }
      }
    }

    return found;
  };

  const getValue = (el) => {
    if (el.isContentEditable) {
      return (el.innerText || el.textContent || "").replace(/\u200b/g, "").trim();
    }
    return String(el.value || "");
  };

  let target = nearestEditable(document.activeElement) || fromSelection();
  if (!target) {
    const candidates = collectCandidates().sort((a, b) => candidateScore(b) - candidateScore(a));
    target = candidates[0] || null;
  }

  if (!target) {
    return { ok: false, error: "No editable prompt field found. Focus a prompt field and try again." };
  }

  document.querySelectorAll(`[${marker}]`).forEach((el) => el.removeAttribute(marker));
  target.setAttribute(marker, "1");

  return { ok: true, value: getValue(target), score: candidateScore(target) };
}

function pageInsertEnhancedPrompt(text) {
  const markerSelector = "[data-promptpilot-target='1']";
  const selectors = [
    markerSelector,
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='plaintext-only'][role='textbox']",
    ".ProseMirror[contenteditable='true']",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "[role='textbox']",
    "textarea",
    "input[type='text']",
    "input[type='search']",
    "input[type='url']",
    "input[type='email']"
  ];

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const isEditable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email"].includes(type);
    }
    return el.isContentEditable;
  };

  const allRoots = () => {
    const roots = [document];
    const elements = document.querySelectorAll("*");
    for (const el of elements) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return roots;
  };

  const collectCandidates = () => {
    const found = [];
    const seen = new Set();
    const roots = allRoots();

    for (const root of roots) {
      for (const selector of selectors) {
        for (const el of root.querySelectorAll(selector)) {
          if (!isEditable(el) || !isVisible(el) || seen.has(el)) continue;
          seen.add(el);
          found.push(el);
        }
      }
    }

    return found;
  };

  const candidateScore = (el) => {
    let score = 0;
    if (el.matches(markerSelector)) score += 200;
    if (el.classList.contains("ProseMirror")) score += 50;
    if ((el.getAttribute("role") || "").toLowerCase() === "textbox") score += 30;
    if (el.isContentEditable) score += 20;
    return score;
  };

  const escapeHtml = (value) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const insertIntoContentEditable = (el, value) => {
    el.focus();

    if (typeof document.execCommand === "function") {
      try {
        document.execCommand("selectAll", false, null);
        const inserted = document.execCommand("insertText", false, value);
        if (inserted) return;
      } catch {
        // Fall back to direct DOM replacement below.
      }
    }

    const paragraphs = String(value)
      .split(/\n/)
      .map((line) => line.trimEnd());

    el.innerHTML = paragraphs.map((line) => {
      if (!line) return "<p><br></p>";
      return `<p>${escapeHtml(line)}</p>`;
    }).join("");
  };

  const target = collectCandidates().sort((a, b) => candidateScore(b) - candidateScore(a))[0] || null;
  if (!target) {
    return { ok: false, error: "Prompt field not found. Re-read the field and try again." };
  }

  if (target.isContentEditable) {
    insertIntoContentEditable(target, text);
  } else {
    target.focus();
    target.value = text;
  }

  target.setAttribute("data-promptpilot-target", "1");
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.focus();

  return { ok: true };
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const { selectionStart, selectionEnd } = els.enhancedPrompt;
  els.enhancedPrompt.focus();
  els.enhancedPrompt.select();
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");

  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
    els.enhancedPrompt.setSelectionRange(selectionStart, selectionEnd);
  }

  if (!copied) {
    throw new Error("Copy failed. Select the text manually and copy it.");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!els.loginForm.reportValidity()) {
    setStatus(validationMessageFor(els.loginForm), "error");
    return;
  }

  try {
    await withBusy("login", async () => {
      setStatus("Logging in...");
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: els.loginEmail.value,
          password: els.loginPassword.value
        })
      });
      state.token = data.token;
      await saveLocal({ token: state.token });
      els.loginPassword.value = "";
      await refreshMe();
      await saveDraft();
      setStatus("Logged in.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleRegister(event) {
  event.preventDefault();
  if (!els.registerForm.reportValidity()) {
    setStatus(validationMessageFor(els.registerForm), "error");
    return;
  }

  try {
    await withBusy("register", async () => {
      setStatus("Creating account...");
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: els.registerEmail.value,
          password: els.registerPassword.value
        })
      });
      state.token = data.token;
      await saveLocal({ token: state.token });
      els.registerPassword.value = "";
      await refreshMe();
      await saveDraft();
      setStatus("Account created.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleRedeem() {
  try {
    const code = els.redeemCode.value.trim();
    if (!code) throw new Error("Enter an access code first.");

    await withBusy("redeem", async () => {
      setStatus("Redeeming...");
      const data = await apiFetch("/api/redeem", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      els.redeemCode.value = "";
      await refreshMe();
      setStatus(`Code redeemed. Plan is now ${data.user.plan}.`, "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleLogout() {
  await withBusy("logout", async () => {
    try {
      if (state.token) {
        await apiFetch("/api/auth/logout", { method: "POST" });
      }
    } catch (error) {
      console.warn(error);
    } finally {
      state.token = "";
      state.currentUser = null;
      state.buyMeACoffeeUrl = "";
      await saveLocal({ token: "" });
      showLogin();
      setAuthView(false);
      setStatus("Logged out.", "success");
    }
  });
}

function handleOpenSupporterLink() {
  if (!state.buyMeACoffeeUrl) return;
  chrome.tabs.create({ url: state.buyMeACoffeeUrl });
}

async function handleCopy() {
  try {
    const text = els.enhancedPrompt.value.trim();
    if (!text) throw new Error("No enhanced prompt to copy.");

    await withBusy("copy", async () => {
      await copyTextToClipboard(text);
      setStatus("Enhanced prompt copied.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleRead() {
  try {
    if (!isSupportedTab()) {
      throw new Error("Switch to a regular website tab to read from the page.");
    }

    await withBusy("read", async () => {
      const results = await injectAndRun(pageReadFocusedField, [], { allFrames: true });
      const best = results
        .filter((entry) => entry?.result?.ok)
        .sort((a, b) => (b.result.score || 0) - (a.result.score || 0))[0];

      if (!best) {
        const firstError = results.find((entry) => entry?.result?.error)?.result?.error;
        throw new Error(firstError || "Could not read the field.");
      }

      state.targetFrameId = best.frameId;
      els.sourcePrompt.value = best.result.value || "";
      updateUiState();
      await saveDraft();
      setStatus("Focused field captured.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleEnhance() {
  try {
    if (!state.token) throw new Error("Log in first.");
    const prompt = els.sourcePrompt.value.trim();
    if (!prompt) throw new Error("Paste a prompt or read a focused field first.");

    await withBusy("enhance", async () => {
      setStatus("Enhancing...");
      const data = await apiFetch("/api/enhance", {
        method: "POST",
        body: JSON.stringify({
          site: currentSiteKey(),
          mode: els.mode.value,
          prompt
        })
      });

      els.enhancedPrompt.value = data.enhancedPrompt || "";
      if (state.currentUser && data.usage) {
        els.accountUsage.textContent = formatUsage(data.usage);
      }
      updateUiState();
      await saveDraft();
      setStatus("Enhanced prompt ready.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleInsert() {
  try {
    const text = els.enhancedPrompt.value.trim();
    if (!text) throw new Error("No enhanced prompt to insert.");
    if (!isSupportedTab()) {
      throw new Error("Switch to a regular website tab to insert into the page.");
    }

    await withBusy("insert", async () => {
      let results = [];

      if (typeof state.targetFrameId === "number") {
        results = await injectAndRun(pageInsertEnhancedPrompt, [text], {
          frameIds: [state.targetFrameId]
        });
      }

      let success = results.find((entry) => entry?.result?.ok);
      if (!success) {
        results = await injectAndRun(pageInsertEnhancedPrompt, [text], { allFrames: true });
        success = results.find((entry) => entry?.result?.ok);
      }

      if (!success) {
        const firstError = results.find((entry) => entry?.result?.error)?.result?.error;
        throw new Error(firstError || "Insert failed.");
      }

      state.targetFrameId = success.frameId;
      await saveDraft();
      setStatus("Inserted into page.", "success");
    });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function handlePromptShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
  event.preventDefault();

  if (event.currentTarget === els.sourcePrompt && !els.enhanceBtn.disabled) {
    void handleEnhance();
  }

  if (event.currentTarget === els.enhancedPrompt && !els.insertBtn.disabled) {
    void handleInsert();
  }
}

function bindEventListeners() {
  if (state.listenersBound) return;
  state.listenersBound = true;

  els.showLoginBtn.addEventListener("click", showLogin);
  els.showRegisterBtn.addEventListener("click", showRegister);
  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegister);
  els.redeemBtn.addEventListener("click", handleRedeem);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.supporterLinkBtn.addEventListener("click", handleOpenSupporterLink);
  els.readBtn.addEventListener("click", handleRead);
  els.enhanceBtn.addEventListener("click", handleEnhance);
  els.copyBtn.addEventListener("click", handleCopy);
  els.insertBtn.addEventListener("click", handleInsert);
  els.mode.addEventListener("change", () => {
    updateUiState();
    void saveDraft();
  });
  els.sourcePrompt.addEventListener("input", () => {
    updateUiState();
    void saveDraft();
  });
  els.enhancedPrompt.addEventListener("input", () => {
    updateUiState();
    void saveDraft();
  });
  els.sourcePrompt.addEventListener("keydown", handlePromptShortcut);
  els.enhancedPrompt.addEventListener("keydown", handlePromptShortcut);
  els.redeemCode.addEventListener("input", updateUiState);
  els.apiBase.addEventListener("input", updateUiState);

  els.saveApiBaseBtn.addEventListener("click", async () => {
    try {
      await withBusy("saveApiBase", async () => {
        state.apiBase = els.apiBase.value.trim();
        await saveLocal({ apiBase: state.apiBase });
        flashApiBaseStatus("Saved");
        await refreshMe();
        setStatus("Connection saved.", "success");
      });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

async function init() {
  showLogin();
  bindEventListeners();

  const local = await loadLocal(["apiBase", "token", DRAFT_STORAGE_KEY]);
  const savedApiBase = String(local.apiBase || "").trim();
  const shouldMigrateApiBase = !savedApiBase || LEGACY_API_BASES.has(savedApiBase);

  state.apiBase = shouldMigrateApiBase ? DEFAULT_API_BASE : savedApiBase;
  state.token = local.token || "";

  if (shouldMigrateApiBase) {
    await saveLocal({ apiBase: state.apiBase });
  }

  els.apiBase.value = state.apiBase;
  restoreDraft(local[DRAFT_STORAGE_KEY]);
  updateUiState();

  await refreshCurrentTab();
  await refreshMe();
}

window.addEventListener("error", (event) => {
  setStatus(event.message || "Popup error", "error");
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || "Unexpected popup error";
  setStatus(message, "error");
});

init().catch((error) => {
  console.error(error);
  setStatus(error.message, "error");
});
