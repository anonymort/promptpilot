import { createApiError, shouldClearStoredToken } from "./popup-logic.js";

const DRAFT_STORAGE_KEY = "promptDraft";

const state = {
  apiBase: "",
  token: "",
  currentUser: null,
  currentTab: null,
  listenersBound: false,
  targetFrameId: null
};

const els = {
  authBadge: document.getElementById("authBadge"),
  apiBase: document.getElementById("apiBase"),
  saveApiBaseBtn: document.getElementById("saveApiBaseBtn"),
  apiBaseStatus: document.getElementById("apiBaseStatus"),
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
  accountEmail: document.getElementById("accountEmail"),
  accountPlan: document.getElementById("accountPlan"),
  accountUsage: document.getElementById("accountUsage"),
  redeemCode: document.getElementById("redeemCode"),
  redeemBtn: document.getElementById("redeemBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  currentSite: document.getElementById("currentSite"),
  mode: document.getElementById("mode"),
  readBtn: document.getElementById("readBtn"),
  enhanceBtn: document.getElementById("enhanceBtn"),
  insertBtn: document.getElementById("insertBtn"),
  sourcePrompt: document.getElementById("sourcePrompt"),
  enhancedPrompt: document.getElementById("enhancedPrompt"),
  status: document.getElementById("status")
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#ef4444" : "";
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

async function refreshCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTab = tab || null;
    if (!tab?.url) {
      els.currentSite.textContent = "No active tab";
      return;
    }

    const hostname = new URL(tab.url).hostname;
    els.currentSite.textContent = hostname;
  } catch {
    els.currentSite.textContent = "Tab unavailable";
  }
}

async function refreshMe() {
  if (!state.token || !state.apiBase) {
    state.currentUser = null;
    setAuthView(false);
    return;
  }

  try {
    const data = await apiFetch("/api/me", { method: "GET" });
    state.currentUser = data.user;
    setAuthView(true);
    els.accountEmail.textContent = data.user.email;
    els.accountPlan.textContent = data.user.plan + (data.user.planExpiresAt ? ` until ${new Date(data.user.planExpiresAt).toLocaleDateString()}` : "");
    els.accountUsage.textContent = `${data.usage.usedThisMonth} / ${data.usage.monthlyLimit}`;
  } catch (error) {
    console.warn(error);
    if (shouldClearStoredToken(error)) {
      state.currentUser = null;
      state.token = "";
      await saveLocal({ token: "" });
      setAuthView(false);
      return;
    }
    setStatus(error.message || "Could not refresh account.", true);
  }
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

async function handleLogin(event) {
  event.preventDefault();
  if (!els.loginForm.reportValidity()) {
    setStatus(validationMessageFor(els.loginForm), true);
    return;
  }

  try {
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
    await refreshMe();
    await saveDraft();
    setStatus("Logged in.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  if (!els.registerForm.reportValidity()) {
    setStatus(validationMessageFor(els.registerForm), true);
    return;
  }

  try {
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
    await refreshMe();
    await saveDraft();
    setStatus("Account created.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleRedeem() {
  try {
    const data = await apiFetch("/api/redeem", {
      method: "POST",
      body: JSON.stringify({ code: els.redeemCode.value })
    });
    els.redeemCode.value = "";
    await refreshMe();
    setStatus(`Code redeemed. Plan is now ${data.user.plan}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleLogout() {
  try {
    if (state.token) {
      await apiFetch("/api/auth/logout", { method: "POST" });
    }
  } catch (error) {
    console.warn(error);
  } finally {
    state.token = "";
    state.currentUser = null;
    await saveLocal({ token: "" });
    setAuthView(false);
    setStatus("Logged out.");
  }
}

async function handleRead() {
  try {
    const results = await injectAndRun(pageReadFocusedField, [], { allFrames: true });
    const best = results
      .filter((entry) => entry?.result?.ok)
      .sort((a, b) => (b.result.score || 0) - (a.result.score || 0))[0];

    if (!best) {
      const firstError = results.find((entry) => entry?.result?.error)?.result?.error;
      throw new Error(firstError || "Could not read the field");
    }

    state.targetFrameId = best.frameId;
    els.sourcePrompt.value = best.result.value || "";
    await saveDraft();
    setStatus("Focused field captured.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleEnhance() {
  try {
    if (!state.token) throw new Error("Log in first.");
    const prompt = els.sourcePrompt.value.trim();
    if (!prompt) throw new Error("Paste a prompt or read a focused field first.");

    const hostname = state.currentTab?.url ? new URL(state.currentTab.url).hostname : "unknown";
    const site = hostname.replace(/^www\./, "");

    setStatus("Enhancing...");
    const data = await apiFetch("/api/enhance", {
      method: "POST",
      body: JSON.stringify({
        site,
        mode: els.mode.value,
        prompt
      })
    });

    els.enhancedPrompt.value = data.enhancedPrompt || "";
    if (state.currentUser) {
      els.accountUsage.textContent = `${data.usage.usedThisMonth} / ${data.usage.monthlyLimit}`;
    }
    await saveDraft();
    setStatus("Enhanced prompt ready.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleInsert() {
  try {
    const text = els.enhancedPrompt.value.trim();
    if (!text) throw new Error("No enhanced prompt to insert.");
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
      throw new Error(firstError || "Insert failed");
    }

    state.targetFrameId = success.frameId;
    await saveDraft();
    setStatus("Inserted into page.");
  } catch (error) {
    setStatus(error.message, true);
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
  els.readBtn.addEventListener("click", handleRead);
  els.enhanceBtn.addEventListener("click", handleEnhance);
  els.insertBtn.addEventListener("click", handleInsert);
  els.mode.addEventListener("change", saveDraft);
  els.sourcePrompt.addEventListener("input", saveDraft);
  els.enhancedPrompt.addEventListener("input", saveDraft);

  els.saveApiBaseBtn.addEventListener("click", async () => {
    state.apiBase = els.apiBase.value.trim();
    await saveLocal({ apiBase: state.apiBase });
    els.apiBaseStatus.textContent = "Saved";
    setTimeout(() => {
      els.apiBaseStatus.textContent = "";
    }, 1200);
    await refreshMe();
  });
}

async function init() {
  showLogin();
  bindEventListeners();

  const local = await loadLocal(["apiBase", "token", DRAFT_STORAGE_KEY]);
  state.apiBase = local.apiBase || "http://127.0.0.1:8787";
  state.token = local.token || "";

  els.apiBase.value = state.apiBase;
  restoreDraft(local[DRAFT_STORAGE_KEY]);

  await refreshCurrentTab();
  await refreshMe();
}

window.addEventListener("error", (event) => {
  setStatus(event.message || "Popup error", true);
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || "Unexpected popup error";
  setStatus(message, true);
});

init().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});
