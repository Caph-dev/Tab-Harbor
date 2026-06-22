/**
 * background.js — Service Worker
 *
 * Keeps Tab Harbor pages in sync when tabs change.
 * The toolbar badge is intentionally kept empty.
 */

try {
  importScripts('local-backup.js');
} catch (error) {
  console.warn('[tab-harbor bg] Local backup module failed to load:', error);
}

try {
  importScripts('favicon-cache.js');
} catch (error) {
  console.warn('[tab-harbor bg] Favicon cache module failed to load:', error);
}

const faviconCacheApi = globalThis.TabHarborFaviconCache;

function rememberTabFavicon(tab) {
  if (!faviconCacheApi?.fetchAndStoreFavicon) return;
  const url = tab?.url || tab?.pendingUrl || '';
  if (!url) return;

  const hostname = faviconCacheApi.normalizeFaviconHostname(url);
  if (!faviconCacheApi.isCacheableFaviconHostname?.(hostname)) return;

  const favIconUrl = String(tab?.favIconUrl || '').trim();
  const sourceUrl = faviconCacheApi.isPersistableFaviconUrl?.(favIconUrl) ? favIconUrl : '';

  void faviconCacheApi.initFaviconCache().then(() => faviconCacheApi.fetchAndStoreFavicon({
    hostname,
    sourceUrl,
    pageUrl: url,
  }));
}

async function seedFaviconCacheFromOpenTabs() {
  if (!chrome.tabs?.query || !faviconCacheApi?.rememberFaviconCandidate) return;
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      rememberTabFavicon(tab);
    }
  } catch (error) {
    console.warn('[tab-harbor bg] Favicon cache seed failed:', error);
  }
}

const TAB_HARBOR_BACKGROUND_DEBUG = false;
const LOCAL_BACKUP_DAILY_ALARM_NAME = 'tab-harbor-local-backup-daily';
const LOCAL_BACKUP_PENDING_ALARM_NAME = 'tab-harbor-local-backup-pending';
const LOCAL_BACKUP_CHANGE_DELAY_MINUTES = 1;
const LOCAL_BACKUP_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const LOCAL_BACKUP_PERIOD_MINUTES = 24 * 60;

const debugLog = (...args) => {
  if (TAB_HARBOR_BACKGROUND_DEBUG) console.log(...args);
};

debugLog('[tab-harbor bg] Service worker loaded, registering event listeners...');

async function updateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '' });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function storageGetAll(area) {
  if (!area?.get) return {};
  return area.get(null);
}

async function storageSet(area, items) {
  if (!area?.set) return;
  await area.set(items);
}

async function storageGet(area, keys) {
  if (!area?.get) return {};
  return area.get(keys);
}

async function downloadBackupFile(filename, payload) {
  const backupApi = globalThis.TabHarborLocalBackup;
  if (!backupApi?.createBackupDataUrl || !chrome.downloads?.download) return false;

  const url = backupApi.createBackupDataUrl(payload);
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  return true;
}

async function pruneOldLocalBackupFiles() {
  const backupApi = globalThis.TabHarborLocalBackup;
  if (!backupApi?.getPrunableBackupDownloadIds || !chrome.downloads?.search || !chrome.downloads?.removeFile) {
    return 0;
  }

  try {
    const downloads = await chrome.downloads.search({
      query: ['tab-harbor-backup-'],
      limit: 0,
    });
    const ids = backupApi.getPrunableBackupDownloadIds(downloads);

    for (const id of ids) {
      try {
        await chrome.downloads.removeFile(id);
      } catch (error) {
        console.warn('[tab-harbor bg] Failed to remove old local backup file:', error);
      }

      try {
        await chrome.downloads.erase?.({ id });
      } catch {
        // Removing the history row is best-effort; the file cleanup above is what matters.
      }
    }

    return ids.length;
  } catch (error) {
    console.warn('[tab-harbor bg] Local backup pruning failed:', error);
    return 0;
  }
}

async function runLocalBackup(reason = 'automatic') {
  const backupApi = globalThis.TabHarborLocalBackup;
  if (!backupApi?.createBackupPayload) return false;

  try {
    const [local, sync] = await Promise.all([
      storageGetAll(chrome.storage.local),
      storageGetAll(chrome.storage.sync),
    ]);
    const createdAt = new Date().toISOString();
    const payload = backupApi.createBackupPayload({
      local,
      sync,
      createdAt,
      extensionId: chrome.runtime.id,
      manifest: chrome.runtime.getManifest?.() || {},
      reason,
    });

    await downloadBackupFile(backupApi.LATEST_BACKUP_FILENAME, payload);
    await downloadBackupFile(backupApi.getDailyBackupFilename(new Date()), payload);
    await pruneOldLocalBackupFiles();

    await storageSet(chrome.storage.local, {
      [backupApi.BACKUP_META_KEY]: {
        lastBackupAt: createdAt,
        reason,
        summary: payload.summary,
      },
    });
    debugLog('[tab-harbor bg] Local backup written', payload.summary);
    return true;
  } catch (error) {
    console.warn('[tab-harbor bg] Local backup failed:', error);
    return false;
  }
}

function scheduleLocalBackup() {
  if (!chrome.alarms?.create) {
    void runLocalBackup('storage-change');
    return;
  }

  chrome.alarms.create(LOCAL_BACKUP_PENDING_ALARM_NAME, {
    delayInMinutes: LOCAL_BACKUP_CHANGE_DELAY_MINUTES,
  });
}

function ensureLocalBackupAlarm() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(LOCAL_BACKUP_DAILY_ALARM_NAME, {
    delayInMinutes: 5,
    periodInMinutes: LOCAL_BACKUP_PERIOD_MINUTES,
  });
}

async function scheduleLocalBackupIfStale() {
  const backupApi = globalThis.TabHarborLocalBackup;
  if (!backupApi?.BACKUP_META_KEY) return;

  const local = await storageGet(chrome.storage.local, backupApi.BACKUP_META_KEY);
  const lastBackupAt = local?.[backupApi.BACKUP_META_KEY]?.lastBackupAt || '';
  const lastBackupMs = Date.parse(lastBackupAt);
  if (Number.isFinite(lastBackupMs) && Date.now() - lastBackupMs < LOCAL_BACKUP_STALE_AFTER_MS) return;
  scheduleLocalBackup();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Notify Tab Harbor pages when tabs change so they can refresh
async function notifyTabHarborPages() {
  try {
    // Find all Tab Harbor dashboard pages
    const extensionId = chrome.runtime.id;

    // Query all tabs and filter manually for more reliable matching
    const allTabs = await chrome.tabs.query({});

    debugLog(`[tab-harbor bg] Total tabs: ${allTabs.length}`);
    allTabs.forEach((tab, idx) => {
      debugLog(`[tab-harbor bg] Tab ${idx}: ID=${tab.id}, URL=${tab.url || 'N/A'}, Title=${tab.title || 'N/A'}`);
    });

    const dashboardTabs = allTabs.filter(tab => {
      if (!tab.url) return false;
      // Tab Harbor can appear as either:
      // 1. chrome-extension://EXTENSION_ID/index.html (direct access)
      // 2. chrome://newtab/ with title "Tab Harbor" (new tab override)
      return (
        tab.url.startsWith(`chrome-extension://${extensionId}/index.html`) ||
        (tab.url === 'chrome://newtab/' && tab.title === 'Tab Harbor')
      );
    });

    debugLog(`[tab-harbor bg] Found ${dashboardTabs.length} Tab Harbor page(s) to notify`);

    if (dashboardTabs.length === 0) {
      debugLog('[tab-harbor bg] No Tab Harbor pages open, skipping notification');
      return;
    }

    // Send message to each Tab Harbor page to refresh
    let successCount = 0;
    for (const tab of dashboardTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'tabs-changed' });
        debugLog(`[tab-harbor bg] Notified tab ${tab.id}`);
        successCount++;
      } catch (err) {
        // Tab closed, still loading, or chrome://newtab without a live listener yet — expected.
        const message = String(err?.message || err);
        const benign = /Receiving end does not exist|Could not establish connection/i.test(message);
        if (!benign) {
          console.warn(`[tab-harbor bg] Failed to notify tab ${tab.id}:`, message);
        } else {
          debugLog(`[tab-harbor bg] Skipped notify tab ${tab.id} (no listener):`, message);
        }
      }
    }

    debugLog(`[tab-harbor bg] Successfully notified ${successCount}/${dashboardTabs.length} page(s)`);
  } catch (err) {
    console.warn('[tab-harbor bg] Error in notifyTabHarborPages:', err);
  }
}

// Update badge when the extension is first installed
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'favicon-cache-fetch' || !faviconCacheApi?.fetchAndStoreFavicon) {
    return false;
  }

  void faviconCacheApi.fetchAndStoreFavicon({
    hostname: message.hostname,
    sourceUrl: message.sourceUrl,
    pageUrl: message.pageUrl,
  }).then(result => sendResponse(result)).catch(() => {
    sendResponse({ ok: false, reason: 'handler-error' });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  ensureLocalBackupAlarm();
  scheduleLocalBackup();
  if (faviconCacheApi?.initFaviconCache) {
    void faviconCacheApi.initFaviconCache().then(() => seedFaviconCacheFromOpenTabs());
  }
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  ensureLocalBackupAlarm();
  void scheduleLocalBackupIfStale();
  if (faviconCacheApi?.initFaviconCache) {
    void faviconCacheApi.initFaviconCache().then(() => seedFaviconCacheFromOpenTabs());
  }
});

chrome.alarms?.onAlarm?.addListener(alarm => {
  if (alarm?.name === LOCAL_BACKUP_DAILY_ALARM_NAME) {
    void runLocalBackup('scheduled');
    return;
  }
  if (alarm?.name === LOCAL_BACKUP_PENDING_ALARM_NAME) {
    void runLocalBackup('storage-change');
  }
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  const backupApi = globalThis.TabHarborLocalBackup;
  if (!backupApi?.isRelevantStorageChange?.(changes, areaName)) return;
  scheduleLocalBackup();
});

// Update badge and notify Tab Harbor pages whenever a tab is opened
chrome.tabs.onCreated.addListener(tab => {
  updateBadge();
  rememberTabFavicon(tab);
  notifyTabHarborPages();
});

// Update badge and notify Tab Harbor pages whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
  notifyTabHarborPages();
});

// Update badge and notify Tab Harbor pages when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.favIconUrl) {
    rememberTabFavicon({ ...tab, favIconUrl: changeInfo.favIconUrl });
  }

  // Only notify on status or URL changes, not title/favicon updates
  if (!changeInfo.status && !changeInfo.url) return;
  updateBadge();
  notifyTabHarborPages();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
ensureLocalBackupAlarm();
void scheduleLocalBackupIfStale();
if (faviconCacheApi?.initFaviconCache) {
  void faviconCacheApi.initFaviconCache().then(() => seedFaviconCacheFromOpenTabs());
}
