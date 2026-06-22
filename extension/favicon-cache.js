'use strict';

(function attachFaviconCache(globalScope) {
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'tabHarbor.favicon.cache';
  const MAX_ENTRIES = 240;
  const MAX_ENTRY_BYTES = 12 * 1024;
  const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
  const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const RENDER_MAX_EDGE = 32;
  const REMEMBER_DEBOUNCE_MS = 400;

  let memoryEntries = Object.create(null);
  let initPromise = null;
  let persistTimer = 0;
  let pendingWrites = Object.create(null);
  let inFlightFetches = new Set();

  function nowIso() {
    return new Date().toISOString();
  }

  function getTimestampMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function estimateDataUrlBytes(dataUrl) {
    const value = String(dataUrl || '');
    const marker = 'base64,';
    const markerIndex = value.indexOf(marker);
    if (markerIndex === -1) return value.length;
    const payload = value.slice(markerIndex + marker.length);
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }

  function normalizeFaviconHostname(input = '') {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return '';

    try {
      const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      const url = new URL(withProtocol);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  const BLOCKED_FAVICON_HOSTNAMES = new Set(['chrome', 'chrome-extension', 'extension', 'newtab']);

  function isCacheableFaviconHostname(hostname = '') {
    const key = normalizeFaviconHostname(hostname);
    if (!key || BLOCKED_FAVICON_HOSTNAMES.has(key)) return false;
    if (key === 'localhost') return true;
    return key.includes('.');
  }

  function isFaviconFetchWorkerContext() {
    return typeof importScripts === 'function';
  }

  function isChromeInternalFaviconUrl(url = '') {
    const value = String(url || '').trim();
    if (!value) return false;
    return value.startsWith('chrome://favicon/')
      || value.startsWith('chrome-extension://')
      || value.startsWith('chrome://extension-icon/');
  }

  function isPersistableFaviconUrl(url = '') {
    const value = String(url || '').trim();
    if (!value) return false;
    if (value.startsWith('data:')) return true;
    if (isChromeInternalFaviconUrl(value)) return false;
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  function isUsableLiveFaviconUrl(url = '') {
    const value = String(url || '').trim();
    if (!value) return false;
    if (value.startsWith('data:')) return true;
    if (isChromeInternalFaviconUrl(value)) return false;
    return isPersistableFaviconUrl(value);
  }

  function isGoogleFaviconServiceUrl(url = '') {
    try {
      const host = new URL(String(url || '')).hostname;
      return host === 'www.google.com' || host.endsWith('.gstatic.com');
    } catch {
      return false;
    }
  }

  function isFetchResponseUsableForFavicon(response, blob, candidateUrl = '') {
    if (!blob || !String(blob.type || '').startsWith('image/')) return false;
    if (response?.ok) return true;
    return isGoogleFaviconServiceUrl(candidateUrl);
  }

  function isCacheEntryFresh(entry, maxAgeMs = DEFAULT_MAX_AGE_MS) {
    if (!entry?.dataUrl) return false;
    const updatedAtMs = getTimestampMs(entry.updatedAt);
    if (!updatedAtMs) return false;
    return Date.now() - updatedAtMs <= maxAgeMs;
  }

  function normalizeCacheState(raw) {
    const entries = {};
    const sourceEntries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : {};
    for (const [key, entry] of Object.entries(sourceEntries)) {
      const hostname = normalizeFaviconHostname(key);
      if (!hostname || !entry?.dataUrl) continue;
      entries[hostname] = {
        dataUrl: String(entry.dataUrl),
        updatedAt: entry.updatedAt || nowIso(),
        sourceUrl: String(entry.sourceUrl || ''),
      };
    }
    return {
      v: SCHEMA_VERSION,
      entries,
    };
  }

  function getEntryBytes(entry) {
    return estimateDataUrlBytes(entry?.dataUrl);
  }

  function getTotalBytes(entries) {
    return Object.values(entries).reduce((sum, entry) => sum + getEntryBytes(entry), 0);
  }

  function pruneFaviconEntries(entries, options = {}) {
    const maxEntries = Number(options.maxEntries) || MAX_ENTRIES;
    const maxTotalBytes = Number(options.maxTotalBytes) || MAX_TOTAL_BYTES;
    const maxAgeMs = Number(options.maxAgeMs) || DEFAULT_MAX_AGE_MS;
    const nowMs = Date.now();

    const next = {};
    for (const [hostname, entry] of Object.entries(entries || {})) {
      const updatedAtMs = getTimestampMs(entry?.updatedAt);
      if (!entry?.dataUrl || !updatedAtMs) continue;
      if (nowMs - updatedAtMs > maxAgeMs) continue;
      if (getEntryBytes(entry) > MAX_ENTRY_BYTES) continue;
      next[hostname] = entry;
    }

    let sorted = Object.entries(next).sort((a, b) => getTimestampMs(b[1].updatedAt) - getTimestampMs(a[1].updatedAt));

    while (sorted.length > maxEntries) {
      sorted.pop();
    }

    while (sorted.length && getTotalBytes(Object.fromEntries(sorted)) > maxTotalBytes) {
      sorted.pop();
    }

    return Object.fromEntries(sorted);
  }

  function getCachedDataUrl(hostname = '') {
    const key = normalizeFaviconHostname(hostname);
    if (!key) return '';
    const entry = memoryEntries[key];
    if (!isCacheEntryFresh(entry)) return '';
    return entry.dataUrl || '';
  }

  function upsertMemoryEntry(hostname, entry) {
    const key = normalizeFaviconHostname(hostname);
    if (!key || !entry?.dataUrl) return false;
    memoryEntries[key] = {
      dataUrl: String(entry.dataUrl),
      updatedAt: entry.updatedAt || nowIso(),
      sourceUrl: String(entry.sourceUrl || ''),
    };
    return true;
  }

  function applyCacheState(state) {
    memoryEntries = { ...normalizeCacheState(state).entries };
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = globalScope.setTimeout(() => {
      persistTimer = 0;
      void persistFaviconCache();
    }, REMEMBER_DEBOUNCE_MS);
  }

  async function readCacheFromStorage() {
    const chromeApi = globalScope.chrome;
    if (!chromeApi?.storage?.local?.get) return normalizeCacheState(null);
    const result = await chromeApi.storage.local.get(STORAGE_KEY);
    return normalizeCacheState(result?.[STORAGE_KEY]);
  }

  async function persistFaviconCache() {
    const chromeApi = globalScope.chrome;
    if (!chromeApi?.storage?.local?.set) return;

    const mergedEntries = {
      ...memoryEntries,
      ...pendingWrites,
    };
    pendingWrites = Object.create(null);

    const pruned = pruneFaviconEntries(mergedEntries);
    memoryEntries = { ...pruned };

    await chromeApi.storage.local.set({
      [STORAGE_KEY]: {
        v: SCHEMA_VERSION,
        entries: pruned,
      },
    });
  }

  async function initFaviconCache() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      attachStorageListener();
      const state = await readCacheFromStorage();
      applyCacheState(state);
    })();
    return initPromise;
  }

  function getCodelifeFaviconCandidateUrl(hostname = '', size = 32, pageUrl = '') {
    const key = normalizeFaviconHostname(hostname || pageUrl);
    if (!key) return '';
    const normalizedPage = String(pageUrl || '').trim();
    let targetUrl = normalizedPage;
    if (!targetUrl) {
      try {
        targetUrl = new URL(`https://${key}/`).toString();
      } catch {
        return '';
      }
    }
    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      const params = new URLSearchParams({
        client: 'SOCIAL',
        type: 'FAVICON',
        fallback_opts: 'TYPE,SIZE,URL',
        url: parsed.toString(),
        size: String(size),
      });
      return `https://ico.codelife.cc/faviconV2?${params.toString()}`;
    } catch {
      return '';
    }
  }

  function buildFaviconFetchCandidates({ hostname = '', sourceUrl = '', pageUrl = '' } = {}) {
    const key = normalizeFaviconHostname(hostname || pageUrl);
    if (!isCacheableFaviconHostname(key)) return [];

    const candidates = [];
    const pushCandidate = value => {
      const next = String(value || '').trim();
      if (!next || !isPersistableFaviconUrl(next) || next.startsWith('data:')) return;
      if (!candidates.includes(next)) candidates.push(next);
    };

    pushCandidate(sourceUrl);

    const page = String(pageUrl || '').trim();
    if (page) {
      try {
        const parsed = new URL(page);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          pushCandidate(`${parsed.origin}/favicon.ico`);
        }
      } catch {
        // ignore invalid shortcut/page URLs
      }
    }

    pushCandidate(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(key)}&sz=32`);
    pushCandidate(getCodelifeFaviconCandidateUrl(key, 32, page));
    return candidates;
  }

  function requestFaviconCacheFetch(payload = {}) {
    const chromeApi = globalScope.chrome;
    if (!chromeApi?.runtime?.sendMessage) return Promise.resolve({ ok: false, reason: 'no-runtime' });
    return new Promise(resolve => {
      chromeApi.runtime.sendMessage({
        action: 'favicon-cache-fetch',
        ...payload,
      }, response => {
        const err = chromeApi.runtime?.lastError;
        if (err) {
          resolve({ ok: false, reason: 'message-failed', detail: String(err.message || err) });
          return;
        }
        resolve(response || { ok: false, reason: 'empty-response' });
      });
    });
  }

  function rememberFaviconCandidate({ url = '', favIconUrl = '' } = {}) {
    const hostname = normalizeFaviconHostname(url);
    const sourceUrl = String(favIconUrl || '').trim();
    if (!isCacheableFaviconHostname(hostname) || !isPersistableFaviconUrl(sourceUrl)) return;

    if (sourceUrl.startsWith('data:')) {
      if (estimateDataUrlBytes(sourceUrl) > MAX_ENTRY_BYTES) return;
      upsertMemoryEntry(hostname, { dataUrl: sourceUrl, updatedAt: nowIso(), sourceUrl: '' });
      pendingWrites[hostname] = memoryEntries[hostname];
      schedulePersist();
      return;
    }

    void requestFaviconCacheFetch({
      hostname,
      sourceUrl,
      pageUrl: String(url || ''),
    });
  }

  function scheduleFaviconWarmup({ url = '', favIconUrl = '' } = {}) {
    const hostname = normalizeFaviconHostname(url);
    if (!isCacheableFaviconHostname(hostname) || getCachedDataUrl(hostname)) return;

    const liveSource = String(favIconUrl || '').trim();
    if (liveSource && isPersistableFaviconUrl(liveSource)) {
      rememberFaviconCandidate({ url, favIconUrl: liveSource });
      return;
    }

    void requestFaviconCacheFetch({
      hostname,
      sourceUrl: '',
      pageUrl: String(url || ''),
    });
  }

  function enrichIconSources(iconData = {}, size = 16) {
    const displayHostname = iconData.hostname || '';
    const lookupHostname = normalizeFaviconHostname(displayHostname);
    const sources = Array.isArray(iconData.sources) ? [...iconData.sources] : [];
    if (!lookupHostname) {
      return { hostname: displayHostname, sources };
    }

    const cached = getCachedDataUrl(lookupHostname);
    if (!cached) {
      return { hostname: displayHostname, sources };
    }

    const withoutDupes = sources.filter(source => source && source !== cached);
    const primary = withoutDupes[0] || '';
    const isGoogleFallback = /google\.com\/s2\/favicons/i.test(primary);
    const isLiveFavicon = Boolean(primary && !isGoogleFallback);

    if (isLiveFavicon) {
      const nextSources = [primary, cached];
      for (let index = 1; index < withoutDupes.length; index += 1) {
        const source = withoutDupes[index];
        if (source && !nextSources.includes(source)) nextSources.push(source);
      }
      return { hostname: displayHostname, sources: nextSources };
    }

    const nextSources = [cached];
    for (const source of withoutDupes) {
      if (source && !nextSources.includes(source)) nextSources.push(source);
    }
    return { hostname: displayHostname, sources: nextSources };
  }

  async function blobToRawImageDataUrl(blob) {
    if (!blob || !String(blob.type || '').startsWith('image/')) return '';
    const buffer = await blob.arrayBuffer();
    if (!buffer?.byteLength || buffer.byteLength > MAX_ENTRY_BYTES) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    const mime = String(blob.type || 'image/png').split(';')[0].trim() || 'image/png';
    const dataUrl = `data:${mime};base64,${btoa(binary)}`;
    if (estimateDataUrlBytes(dataUrl) > MAX_ENTRY_BYTES) return '';
    return dataUrl;
  }

  async function blobToFaviconDataUrl(blob) {
    if (!blob) return '';

    if (!globalScope.createImageBitmap) {
      return blobToRawImageDataUrl(blob);
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return blobToRawImageDataUrl(blob);
    }
    const largestEdge = Math.max(bitmap.width, bitmap.height, 1);
    const scale = Math.min(1, RENDER_MAX_EDGE / largestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : null;
    if (!canvas) {
      bitmap.close?.();
      return blobToRawImageDataUrl(blob);
    }

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return blobToRawImageDataUrl(blob);
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const outputBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    const buffer = await outputBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    const dataUrl = `data:image/webp;base64,${btoa(binary)}`;
    if (estimateDataUrlBytes(dataUrl) > MAX_ENTRY_BYTES) return '';
    return dataUrl;
  }

  async function fetchAndStoreFavicon({ hostname = '', sourceUrl = '', pageUrl = '' } = {}) {
    const key = normalizeFaviconHostname(hostname || pageUrl);
    if (!isCacheableFaviconHostname(key)) {
      return { ok: false, reason: 'invalid-hostname' };
    }

    if (!isFaviconFetchWorkerContext()) {
      return requestFaviconCacheFetch({ hostname: key, sourceUrl, pageUrl });
    }

    const candidates = buildFaviconFetchCandidates({ hostname: key, sourceUrl, pageUrl });
    if (!candidates.length) {
      return { ok: false, reason: 'invalid-input' };
    }

    const fetchKey = `${key}|${candidates.join('|')}`;
    if (inFlightFetches.has(fetchKey)) {
      return { ok: false, reason: 'in-flight' };
    }
    inFlightFetches.add(fetchKey);

    try {
      for (const candidateUrl of candidates) {
        try {
          const response = await fetch(candidateUrl, { cache: 'force-cache' });
          const blob = await response.blob();
          if (!isFetchResponseUsableForFavicon(response, blob, candidateUrl)) continue;

          const dataUrl = await blobToFaviconDataUrl(blob);
          if (!dataUrl || estimateDataUrlBytes(dataUrl) > MAX_ENTRY_BYTES) continue;

          upsertMemoryEntry(key, {
            dataUrl,
            updatedAt: nowIso(),
            sourceUrl: candidateUrl,
          });
          pendingWrites[key] = memoryEntries[key];
          await persistFaviconCache();
          return { ok: true, hostname: key, sourceUrl: candidateUrl };
        } catch {
          // try the next candidate source
        }
      }
      return { ok: false, reason: 'fetch-failed' };
    } finally {
      inFlightFetches.delete(fetchKey);
    }
  }

  function attachStorageListener() {
    const chromeApi = globalScope.chrome;
    if (!chromeApi?.storage?.onChanged?.addListener) return;
    if (attachStorageListener.attached) return;
    attachStorageListener.attached = true;

    chromeApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[STORAGE_KEY]) return;
      applyCacheState(changes[STORAGE_KEY].newValue);
    });
  }

  const api = {
    DEFAULT_MAX_AGE_MS,
    MAX_ENTRIES,
    MAX_ENTRY_BYTES,
    MAX_TOTAL_BYTES,
    STORAGE_KEY,
    applyCacheState,
    enrichIconSources,
    estimateDataUrlBytes,
    fetchAndStoreFavicon,
    getCachedDataUrl,
    initFaviconCache,
    isCacheEntryFresh,
    isPersistableFaviconUrl,
    normalizeCacheState,
    normalizeFaviconHostname,
    pruneFaviconEntries,
    isCacheableFaviconHostname,
    isChromeInternalFaviconUrl,
    isFetchResponseUsableForFavicon,
    isFaviconFetchWorkerContext,
    isGoogleFaviconServiceUrl,
    isUsableLiveFaviconUrl,
    rememberFaviconCandidate,
    scheduleFaviconWarmup,
    buildFaviconFetchCandidates,
    getCodelifeFaviconCandidateUrl,
    upsertMemoryEntry,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborFaviconCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);