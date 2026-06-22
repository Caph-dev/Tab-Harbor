'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCacheState,
  buildFaviconFetchCandidates,
  enrichIconSources,
  estimateDataUrlBytes,
  getCachedDataUrl,
  isCacheEntryFresh,
  isCacheableFaviconHostname,
  isChromeInternalFaviconUrl,
  isFetchResponseUsableForFavicon,
  isPersistableFaviconUrl,
  isUsableLiveFaviconUrl,
  normalizeCacheState,
  normalizeFaviconHostname,
  pruneFaviconEntries,
  upsertMemoryEntry,
} = require('./favicon-cache.js');

test('normalizeFaviconHostname strips www and lowercases', () => {
  assert.equal(normalizeFaviconHostname('https://WWW.Example.com/path'), 'example.com');
  assert.equal(normalizeFaviconHostname('chrome://newtab/'), '');
});

test('isPersistableFaviconUrl accepts http(s) and data urls', () => {
  assert.equal(isPersistableFaviconUrl('https://example.com/favicon.ico'), true);
  assert.equal(isPersistableFaviconUrl('data:image/png;base64,abc'), true);
  assert.equal(isPersistableFaviconUrl('chrome://favicon'), false);
});

test('chrome internal favicon urls are not usable as live img sources', () => {
  const chromeFavicon = 'chrome://favicon/https://axonhub.caph.me/';
  assert.equal(isChromeInternalFaviconUrl(chromeFavicon), true);
  assert.equal(isPersistableFaviconUrl(chromeFavicon), false);
  assert.equal(isUsableLiveFaviconUrl(chromeFavicon), false);
  assert.equal(isUsableLiveFaviconUrl('https://example.com/icon.png'), true);
});

test('pruneFaviconEntries enforces max entry count by recency', () => {
  const now = Date.now();
  const entries = {
    old: {
      dataUrl: 'data:image/webp;base64,AAAA',
      updatedAt: new Date(now - 10_000).toISOString(),
    },
    fresh: {
      dataUrl: 'data:image/webp;base64,BBBB',
      updatedAt: new Date(now).toISOString(),
    },
  };

  const pruned = pruneFaviconEntries(entries, { maxEntries: 1, maxTotalBytes: 1024 * 1024, maxAgeMs: 30 * 86400000 });
  assert.deepEqual(Object.keys(pruned), ['fresh']);
});

test('enrichIconSources prefers cached icon when only google fallback exists', () => {
  applyCacheState({
    entries: {
      'github.com': {
        dataUrl: 'data:image/webp;base64,CACHED',
        updatedAt: new Date().toISOString(),
      },
    },
  });

  const enriched = enrichIconSources({
    hostname: 'github.com',
    sources: ['https://www.google.com/s2/favicons?domain=github.com&sz=32'],
  }, 32);

  assert.equal(enriched.sources[0], 'data:image/webp;base64,CACHED');
  assert.match(enriched.sources[1], /google\.com\/s2\/favicons/);
});

test('enrichIconSources keeps live tab favicon ahead of cache', () => {
  applyCacheState({
    entries: {
      'github.com': {
        dataUrl: 'data:image/webp;base64,CACHED',
        updatedAt: new Date().toISOString(),
      },
    },
  });

  const live = 'https://github.githubassets.com/favicons/favicon.svg';
  const enriched = enrichIconSources({
    hostname: 'github.com',
    sources: [live, 'https://www.google.com/s2/favicons?domain=github.com&sz=32'],
  }, 32);

  assert.equal(enriched.sources[0], live);
  assert.equal(enriched.sources[1], 'data:image/webp;base64,CACHED');
});

test('getCachedDataUrl returns fresh entries only', () => {
  upsertMemoryEntry('example.com', {
    dataUrl: 'data:image/webp;base64,ZZZZ',
    updatedAt: new Date().toISOString(),
  });
  assert.equal(getCachedDataUrl('www.example.com'), 'data:image/webp;base64,ZZZZ');

  applyCacheState({
    entries: {
      'stale.com': {
        dataUrl: 'data:image/webp;base64,OLD',
        updatedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
      },
    },
  });
  assert.equal(getCachedDataUrl('stale.com'), '');
  assert.equal(isCacheEntryFresh(normalizeCacheState({
    entries: { 'stale.com': { dataUrl: 'data:image/webp;base64,OLD', updatedAt: new Date(Date.now() - 40 * 86400000).toISOString() } },
  }).entries['stale.com']), false);
});

test('estimateDataUrlBytes approximates base64 payload size', () => {
  const dataUrl = 'data:image/webp;base64,YWJj';
  assert.equal(estimateDataUrlBytes(dataUrl), 3);
});

test('isFetchResponseUsableForFavicon accepts google 404 image/png bodies', () => {
  const googleUrl = 'https://www.google.com/s2/favicons?domain=axonhub.caph.me&sz=32';
  const blob = { type: 'image/png', size: 100 };
  assert.equal(isFetchResponseUsableForFavicon({ ok: false, status: 404 }, blob, googleUrl), true);
  assert.equal(isFetchResponseUsableForFavicon({ ok: false, status: 404 }, blob, 'https://example.com/x.png'), false);
});

test('isCacheableFaviconHostname rejects chrome internal hosts', () => {
  assert.equal(isCacheableFaviconHostname('axonhub.caph.me'), true);
  assert.equal(isCacheableFaviconHostname('chrome'), false);
  assert.equal(isCacheableFaviconHostname('chrome-extension'), false);
});

test('buildFaviconFetchCandidates falls back to origin favicon and google', () => {
  const candidates = buildFaviconFetchCandidates({
    pageUrl: 'https://axonhub.caph.me/',
  });

  assert.equal(candidates[0], 'https://axonhub.caph.me/favicon.ico');
  assert.match(candidates[1], /google\.com\/s2\/favicons/);
  assert.match(candidates[2], /ico\.codelife\.cc\/faviconV2/);
});