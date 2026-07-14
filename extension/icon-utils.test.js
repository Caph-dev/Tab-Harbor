'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.chrome = {
  runtime: {
    getURL: path => `chrome-extension://test-extension${path}`,
  },
};

require('./adaptive-icon.js');
require('./favicon-cache.js');

const {
  escapeHtmlAttribute,
  getChromeFaviconUrl,
  getFallbackLabel,
  getFaviconRequestSize,
  getGoogleFaviconUrl,
  getGroupIcon,
  getIconSources,
} = require('./icon-utils.js');

const { applyCacheState } = require('./favicon-cache.js');

test('getIconSources prefers real favicon before the local Chrome fallback', () => {
  const iconData = getIconSources({
    favIconUrl: 'https://example.com/favicon.ico',
    url: 'https://www.example.com/page',
  }, 32);

  assert.equal(iconData.hostname, 'www.example.com');
  assert.equal(iconData.sources[0], 'https://example.com/favicon.ico');
  assert.match(iconData.sources[1], /^chrome-extension:\/\/test-extension\/_favicon\//);
  assert.equal(new URL(iconData.sources[1]).searchParams.get('pageUrl'), 'https://www.example.com/page');
});

test('getGroupIcon falls back to the local Chrome favicon service', () => {
  const iconData = getGroupIcon({
    tabs: [{ url: 'https://chatgpt.com/c/test' }],
  }, 'ChatGPT', 32);

  assert.match(iconData.src, /^chrome-extension:\/\/test-extension\/_favicon\//);
  assert.equal(iconData.fallbackSrc, '');
  assert.equal(iconData.fallbackLabel, 'C');
});

test('getFallbackLabel derives stable initials from labels and hosts', () => {
  assert.equal(getFallbackLabel('GitHub Issues', 'github.com'), 'GI');
  assert.equal(getFallbackLabel('', 'www.wikipedia.org'), 'WI');
  assert.equal(getGoogleFaviconUrl('github.com', 16), 'https://www.google.com/s2/favicons?domain=github.com&sz=16');
});

test('getChromeFaviconUrl requests a high-DPI source without exposing it to network services', () => {
  const previousPixelRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    const faviconUrl = getChromeFaviconUrl('https://example.com/private?token=secret', 32);
    const parsed = new URL(faviconUrl);
    assert.equal(parsed.protocol, 'chrome-extension:');
    assert.equal(parsed.pathname, '/_favicon/');
    assert.equal(parsed.searchParams.get('pageUrl'), 'https://example.com/private?token=secret');
    assert.equal(parsed.searchParams.get('size'), '64');
    assert.equal(getFaviconRequestSize(32), 64);
  } finally {
    globalThis.devicePixelRatio = previousPixelRatio;
  }
});

test('escapeHtmlAttribute protects custom tooltip text', () => {
  assert.equal(
    escapeHtmlAttribute('ChatGPT "Projects" & Notes'),
    'ChatGPT &quot;Projects&quot; &amp; Notes'
  );
});

test('getIconSources uses persisted favicon cache when tab favicon is absent', () => {
  applyCacheState({
    entries: {
      'chatgpt.com': {
        dataUrl: 'data:image/webp;base64,CACHED',
        updatedAt: new Date().toISOString(),
      },
    },
  });

  const iconData = getIconSources({
    url: 'https://chatgpt.com/c/test',
  }, 32);

  assert.equal(iconData.sources[0], 'data:image/webp;base64,CACHED');
  assert.match(iconData.sources[1], /^chrome-extension:\/\/test-extension\/_favicon\//);
});

test('getIconSources forwards adaptive metadata without changing source order', () => {
  const adaptiveIcon = {
    v: 2,
    width: 32,
    height: 32,
    alphaCoverage: 1,
    edgeCoverage: 1,
    cornerCoverage: 1,
    contentBounds: { x: 0, y: 0, width: 1, height: 1 },
    visualCenter: { x: 0.5, y: 0.5 },
    silhouette: { circle: 0.78, roundedSquare: 0.95, square: 1 },
  };
  applyCacheState({
    entries: {
      'example.com': {
        dataUrl: 'data:image/webp;base64,ADAPTIVE',
        updatedAt: new Date().toISOString(),
        adaptiveIcon,
      },
    },
  });

  const iconData = getIconSources({
    favIconUrl: 'https://example.com/live.svg',
    url: 'https://example.com/page',
  }, 32);

  assert.equal(iconData.sources[0], 'https://example.com/live.svg');
  assert.equal(iconData.sources[1], 'data:image/webp;base64,ADAPTIVE');
  assert.equal(iconData.adaptiveIcon.treatment, 'tile');
});
