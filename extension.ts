import * as vscode from "vscode";
import axios from "axios";
import { request } from "undici";

type UsageResponse = {
  five_hour?: { utilization: number; resets_at: string } | null;
  seven_day?: any;
  [k: string]: any;
};

const SECRET_KEY = "claudeUsage.sessionKey";

// Constants
const API_BASE_URL = "https://claude.ai";
const API_USAGE_PATH = "/api/organizations";
const CF_BM_COOKIE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds
const ERROR_MESSAGE_MAX_LENGTH = 200;
const ERROR_DETAILS_MAX_LENGTH = 500;

// Standard HTTP headers that match Postman's default behavior
function getStandardHeaders(cookieValue: string): Record<string, string> {
  return {
    "Cookie": cookieValue,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };
}

// Format sessionKey into cookie format if needed
function formatSessionKeyCookie(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  if (!trimmed.includes(";") && trimmed.split("=").length <= 2) {
    return `sessionKey=${trimmed}`;
  }
  return trimmed;
}

let refreshTimer: ReturnType<typeof setInterval> | undefined;

// Cache for __cf_bm cookie (expires quickly, so we'll fetch it fresh each time or cache briefly)
let cfBmCookie: string | null = null;
let cfBmCookieExpiry: number = 0;

/**
 * Fetches the __cf_bm cookie from Cloudflare by making an initial request.
 * This cookie is required for subsequent API requests.
 */
async function fetchCfBmCookie(sessionKey: string): Promise<string | null> {
  // Check if we have a cached cookie that's still valid
  const now = Date.now();
  if (cfBmCookie && now < cfBmCookieExpiry) {
    return cfBmCookie;
  }

  const sessionKeyCookie = formatSessionKeyCookie(sessionKey);
  const headers = getStandardHeaders(sessionKeyCookie);

  // Try undici first (better header access) then fetch as fallback
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout fetching __cf_bm cookie")), REQUEST_TIMEOUT_MS);
    });

    const requestPromise = request(API_BASE_URL, {
      method: "GET",
      headers
    });

    const { headers: responseHeaders } = await Promise.race([requestPromise, timeoutPromise]);

    // Extract __cf_bm from Set-Cookie header
    const setCookieHeader = responseHeaders["set-cookie"];
    if (setCookieHeader) {
      const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const cookie of cookieArray) {
        const cfBmMatch = cookie.match(/__cf_bm=([^;]+)/);
        if (cfBmMatch) {
          cfBmCookie = `__cf_bm=${cfBmMatch[1]}`;
          cfBmCookieExpiry = now + CF_BM_COOKIE_CACHE_TTL_MS;
          return cfBmCookie;
        }
      }
    }
  } catch (e: any) {
    // Try with fetch as fallback
    if (!e?.message?.includes("Timeout")) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(API_BASE_URL, {
          method: "GET",
          headers,
          redirect: "follow",
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Note: fetch API may filter Set-Cookie headers, so this might not work
        const setCookieHeaders = response.headers.get("set-cookie");
        if (setCookieHeaders) {
          const cookies = setCookieHeaders.split(',').map(c => c.trim());
          for (const cookie of cookies) {
            const cfBmMatch = cookie.match(/__cf_bm=([^;]+)/);
            if (cfBmMatch) {
              cfBmCookie = `__cf_bm=${cfBmMatch[1]}`;
              cfBmCookieExpiry = now + CF_BM_COOKIE_CACHE_TTL_MS;
              return cfBmCookie;
            }
          }
        }
      } catch (e2: any) {
        console.warn("Failed to fetch __cf_bm cookie:", e2?.message || e2);
      }
    }
  }

  return null;
}

export function activate(context: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(pulse) Claude --";
  status.tooltip = "Claude Usage: click to configure";
  status.command = "claudeUsage.configure";
  status.show();

  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeUsage.configure", async () => {
      // Show quick pick menu for configuration options
      const items = [
        { label: "Edit organization_code", description: "Change your Claude organization code", command: "claudeUsage.editOrganizationCode" },
        { label: "Edit sessionKey", description: "Update your session key or cookie", command: "claudeUsage.editSessionKey" },
        { label: "Open Settings", description: "Open VS Code settings for Claude Usage", command: "claudeUsage.openSettings" },
        { label: "Refresh Now", description: "Manually refresh usage data", command: "claudeUsage.refresh" },
        { label: "Debug Info", description: "Show current configuration details", command: "claudeUsage.debug" },
        { label: "Clear sessionKey", description: "Remove stored session key", command: "claudeUsage.clearSessionKey" }
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Claude Usage: Select an action"
      });

      if (selected) {
        await vscode.commands.executeCommand(selected.command);
      } else {
        // If cancelled, still ensure configured (original behavior)
        await ensureConfigured(context);
        await refreshAndRender(context, status);
        startAutoRefresh(context, status);
      }
    }),

    vscode.commands.registerCommand("claudeUsage.refresh", async () => {
      await refreshAndRender(context, status);
    }),

    vscode.commands.registerCommand("claudeUsage.clearSessionKey", async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage("Claude Usage: sessionKey cleared.");
      await refreshAndRender(context, status);
    }),

    vscode.commands.registerCommand("claudeUsage.debug", async () => {
      const cfg = vscode.workspace.getConfiguration();
      const org = cfg.get<string>("claudeUsage.organizationCode", "").trim();
      const sessionKey = (await context.secrets.get(SECRET_KEY))?.trim() ?? "";
      
      const url = org ? `${API_BASE_URL}${API_USAGE_PATH}/${encodeURIComponent(org)}/usage` : `${API_BASE_URL}${API_USAGE_PATH}/ORG/usage`;
      const info = [
        `Organization Code: ${org ? `${org.substring(0, 4)}...` : "NOT SET"}`,
        `Session Key: ${sessionKey ? `${sessionKey.substring(0, 10)}... (${sessionKey.length} chars)` : "NOT SET"}`,
        `URL: ${url}`
      ].join("\n");
      
      await vscode.window.showInformationMessage(info, { modal: true });
    }),

    vscode.commands.registerCommand("claudeUsage.toggleMode", async () => {
      const cfg = vscode.workspace.getConfiguration();
      const current = cfg.get<string>("claudeUsage.mode", "left");
      const next = current === "left" ? "used" : "left";
      await cfg.update("claudeUsage.mode", next, vscode.ConfigurationTarget.Global);
      await refreshAndRender(context, status);
    }),

    vscode.commands.registerCommand("claudeUsage.editOrganizationCode", async () => {
      const cfg = vscode.workspace.getConfiguration();
      const current = cfg.get<string>("claudeUsage.organizationCode", "").trim();
      
      const newOrg = await vscode.window.showInputBox({
        title: "Claude Usage: Edit organization_code",
        prompt: current ? `Current: ${current.substring(0, 8)}...\nEnter new organization_code:` : "Enter your Claude organization_code:",
        value: current,
        ignoreFocusOut: true
      });

      if (newOrg !== undefined) {
        const trimmed = newOrg.trim();
        if (trimmed) {
          await cfg.update("claudeUsage.organizationCode", trimmed, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage("Claude Usage: organization_code updated.");
          await refreshAndRender(context, status);
        } else {
          vscode.window.showWarningMessage("Claude Usage: organization_code cannot be empty.");
        }
      }
    }),

    vscode.commands.registerCommand("claudeUsage.editSessionKey", async () => {
      const current = (await context.secrets.get(SECRET_KEY))?.trim() ?? "";
      
      const newKey = await vscode.window.showInputBox({
        title: "Claude Usage: Edit sessionKey",
        prompt: current 
          ? `Current: ${current.substring(0, 20)}... (${current.length} chars)\n\nPaste the full Cookie header from Postman (recommended) OR just the sessionKey value.\n\nFrom Postman: Copy the entire Cookie header value\nExample: sessionKey=sk-ant-api03-...; __cf_bm=...; sessionKey=sk-ant-sid01-...\n\nOr just the sessionKey value if you only have that.`
          : "Paste the full Cookie header from Postman (recommended) OR just the sessionKey value.\n\nFrom Postman: Copy the entire Cookie header value\nExample: sessionKey=sk-ant-api03-...; __cf_bm=...; sessionKey=sk-ant-sid01-...\n\nOr just the sessionKey value if you only have that.",
        password: true,
        ignoreFocusOut: true
      });

      if (newKey !== undefined) {
        const trimmed = newKey.trim();
        if (trimmed) {
          await context.secrets.store(SECRET_KEY, trimmed);
          vscode.window.showInformationMessage("Claude Usage: sessionKey updated.");
          await refreshAndRender(context, status);
        } else {
          vscode.window.showWarningMessage("Claude Usage: sessionKey cannot be empty.");
        }
      }
    }),

    vscode.commands.registerCommand("claudeUsage.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "claudeUsage.organizationCode");
    })
  );

  // Restart timer if config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration("claudeUsage.autoRefresh") ||
        e.affectsConfiguration("claudeUsage.refreshSeconds") ||
        e.affectsConfiguration("claudeUsage.organizationCode") ||
        e.affectsConfiguration("claudeUsage.mode")
      ) {
        startAutoRefresh(context, status);
        void refreshAndRender(context, status);
      }
    })
  );

  context.subscriptions.push({ dispose: stopAutoRefresh });

  startAutoRefresh(context, status);
  void refreshAndRender(context, status);
}

export function deactivate() {
  stopAutoRefresh();
}

function startAutoRefresh(context: vscode.ExtensionContext, status: vscode.StatusBarItem) {
  stopAutoRefresh();

  const cfg = vscode.workspace.getConfiguration();
  const enabled = cfg.get<boolean>("claudeUsage.autoRefresh", true);

  // Enforce a sane minimum to avoid hammering
  const seconds = Math.max(30, cfg.get<number>("claudeUsage.refreshSeconds", 60));

  if (!enabled) return;

  refreshTimer = setInterval(() => {
    refreshAndRender(context, status).catch(() => {});
  }, seconds * 1000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

async function ensureConfigured(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();

  let org = cfg.get<string>("claudeUsage.organizationCode", "").trim();
  if (!org) {
    org =
      (await vscode.window.showInputBox({
        title: "Claude Usage: organization_code",
        prompt: "Enter your Claude organization_code",
        ignoreFocusOut: true
      }))?.trim() ?? "";

    if (org) {
      await cfg.update("claudeUsage.organizationCode", org, vscode.ConfigurationTarget.Global);
    }
  }

  let sessionKey = (await context.secrets.get(SECRET_KEY))?.trim() ?? "";
  if (!sessionKey) {
    const sessionKeyInput = await vscode.window.showInputBox({
      title: "Claude Usage: sessionKey or Cookie Header",
      prompt: "Paste the full Cookie header from Postman (recommended) OR just the sessionKey value.\n\nFrom Postman: Copy the entire Cookie header value\nExample: sessionKey=sk-ant-api03-...; __cf_bm=...; sessionKey=sk-ant-sid01-...\n\nOr just the sessionKey value if you only have that.",
      password: true,
      ignoreFocusOut: true
    });
    sessionKey = sessionKeyInput?.trim() ?? "";

    if (sessionKey) {
      await context.secrets.store(SECRET_KEY, sessionKey);
    }
  }
}

async function refreshAndRender(context: vscode.ExtensionContext, status: vscode.StatusBarItem) {
  const cfg = vscode.workspace.getConfiguration();
  const org = cfg.get<string>("claudeUsage.organizationCode", "").trim();
  const sessionKey = (await context.secrets.get(SECRET_KEY))?.trim() ?? "";

  if (!org || !sessionKey) {
    status.text = "$(pulse) Claude --";
    status.tooltip =
      "Claude Usage is not configured.\nClick to set organization_code and sessionKey.";
    status.command = "claudeUsage.configure";
    return;
  }

  try {
    status.text = "$(sync~spin) Claude ...";
    status.tooltip = "Refreshing Claude usage...";
    status.command = "claudeUsage.refresh";

    const data = await fetchUsage(org, sessionKey);

    const five = data?.five_hour;
    if (!five || typeof five.utilization !== "number" || !five.resets_at) {
      status.text = "$(warning) Claude ?";
      status.tooltip = "Unexpected response shape from Claude usage endpoint.";
      status.command = "claudeUsage.refresh";
      return;
    }

    const used = clampPercent(five.utilization);
    const left = clampPercent(100 - used);

    const resetsLocal = formatLocal(five.resets_at);
    const updatedAt = new Date().toLocaleTimeString();

    const mode = cfg.get<string>("claudeUsage.mode", "left");
    const displayValue = mode === "left" ? `${left}% left` : `${used}% used`;

    status.text = `$(pulse) Claude ${displayValue}`;
    status.tooltip =
      `Resets at: ${resetsLocal}\n` +
      `Last updated: ${updatedAt}\n` +
      `Click to toggle between used/left\n` +
      `Use Command Palette (Ctrl+Shift+P) → "Claude Usage: Edit organization_code" or "Edit sessionKey"`;

    status.command = "claudeUsage.toggleMode";
  } catch (e: any) {
    const errorMsg = safeErrorMessage(e);
    const is403 = errorMsg.includes("403");
    
    status.text = "$(error) Claude ERR";
    
    let tooltip = `Failed to refresh Claude usage.\n\nError: ${errorMsg}`;
    
    if (is403) {
      tooltip += `\n\n🔍 Troubleshooting HTTP 403:\n` +
        `1. Verify sessionKey: Get it from browser DevTools → Application → Cookies → claude.ai\n` +
        `2. Check organization_code: Should match your Claude organization\n` +
        `3. SessionKey may be expired: Get a fresh one from an active browser session\n` +
        `4. Try full cookie string: Copy entire Cookie header from Network tab\n` +
        `5. Ensure you're logged into Claude.ai in your browser`;
    }
    
    tooltip += `\n\nClick to reconfigure or use "Claude Usage: Debug Info" command`;
    
    status.tooltip = tooltip;
    status.command = "claudeUsage.configure";
    
    // Also log to console for debugging
    console.error("Claude Usage Error:", errorMsg);
  }
}

async function fetchUsage(org: string, sessionKey: string): Promise<UsageResponse> {
  const url = `${API_BASE_URL}${API_USAGE_PATH}/${encodeURIComponent(org)}/usage`;

  // Format sessionKey cookie
  const sessionKeyCookie = formatSessionKeyCookie(sessionKey);

  // Fetch __cf_bm cookie from Cloudflare (required for API requests)
  const cfBmCookie = await fetchCfBmCookie(sessionKey);
  
  // Combine cookies: __cf_bm (if available) + sessionKey
  const cookieValue = cfBmCookie ? `${cfBmCookie}; ${sessionKeyCookie}` : sessionKeyCookie;

  // Standard headers that Postman sends by default
  const standardHeaders = getStandardHeaders(cookieValue);

  // Try multiple HTTP clients - fetch first (matches Postman), then undici, then axios as fallback
  const methods = [
    // Method 1: Try native fetch (matches Postman's approach)
    async () => {
      const myHeaders = new Headers();
      // Add all standard headers
      Object.entries(standardHeaders).forEach(([key, value]) => {
        myHeaders.append(key, value);
      });

      const requestOptions: RequestInit = {
        method: "GET",
        headers: myHeaders,
        redirect: "follow"
      };

      const response = await fetch(url, requestOptions);
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.substring(0, ERROR_MESSAGE_MAX_LENGTH)}`);
      }

      const data = await response.json() as UsageResponse;
      return data;
    },
    
    // Method 2: Try undici (Node's newer HTTP client with different TLS fingerprint)
    async () => {
      const { statusCode, headers, body } = await request(url, {
        method: "GET",
        headers: standardHeaders
      });

      const data = await body.json() as UsageResponse;
      
      if (statusCode >= 200 && statusCode < 300) {
        return data;
      }
      
      throw new Error(`HTTP ${statusCode}: ${JSON.stringify(data).substring(0, ERROR_MESSAGE_MAX_LENGTH)}`);
    },
    
    // Method 3: Fallback to axios
    async () => {
      const response = await axios.get<UsageResponse>(url, {
        headers: standardHeaders,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      const responseData = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      throw new Error(`HTTP ${response.status}: ${responseData.substring(0, ERROR_MESSAGE_MAX_LENGTH)}`);
    }
  ];

  let lastError: Error | null = null;
  
  for (const method of methods) {
    try {
      return await method();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || String(error);
      
      // If it's a Cloudflare challenge, try next method
      if (errorMsg.includes("Just a moment") || errorMsg.includes("cf-browser-verification") || 
          errorMsg.includes("challenge-platform") || errorMsg.includes("403")) {
        continue; // Try next method
      }
      
      // If it's a different error (like network error), also try next method
      if (!errorMsg.includes("HTTP")) {
        continue;
      }
      
      // If we got a non-403 HTTP error, throw it
      throw error;
    }
  }

  // If all methods failed, format a helpful error message
  const errorMsg = lastError?.message || "Unknown error";
  let errorDetails = errorMsg;
  let errorBody = "";

  if (errorMsg.includes("Just a moment") || errorMsg.includes("cf-browser-verification") || 
      errorMsg.includes("challenge-platform") || errorMsg.includes("403")) {
    errorBody = "\n\n⚠️ Cloudflare bot protection detected.\n\n" +
      "This is a known limitation - Cloudflare blocks automated requests based on TLS fingerprinting.\n" +
      "Postman works because it uses a different HTTP client (libcurl) that Cloudflare trusts.\n\n" +
      "Possible solutions:\n" +
      "1. Use a fresh Cookie header from Postman (__cf_bm cookie expires quickly)\n" +
      "2. Use a proxy service that can handle Cloudflare challenges\n" +
      "3. Contact Claude.ai to request API access or whitelisting";
  } else {
    errorBody = errorMsg.substring(0, ERROR_DETAILS_MAX_LENGTH);
  }

  throw new Error(`${errorDetails}${errorBody}`);
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatLocal(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function safeErrorMessage(e: any): string {
  const msg = typeof e?.message === "string" ? e.message : "Unknown error";
  return msg.slice(0, ERROR_MESSAGE_MAX_LENGTH);
}
