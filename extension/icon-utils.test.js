'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./favicon-cache.js');

const {
  escapeHtmlAttribute,
  getFallbackLabel,
  getGoogleFaviconUrl,
  getGroupIcon,
  getIconSources,
} = require('./icon-utils.js');

const { applyCacheState } = require('./favicon-cache.js');

test('getIconSources prefers real favicon before domain fallback', () => {
  const iconData = getIconSources({
    favIconUrl: 'https://example.com/favicon.ico',
    url: 'https://www.example.com/page',
  }, 32);

  assert.equal(iconData.hostname, 'www.example.com');
  assert.deepEqual(iconData.sources, [
    'https://example.com/favicon.ico',
    'https://www.google.com/s2/favicons?domain=www.example.com&sz=32',
  ]);
});

test('getGroupIcon falls back to google favicon when tab has no real favicon', () => {
  const iconData = getGroupIcon({
    tabs: [{ url: 'https://chatgpt.com/c/test' }],
  }, 'ChatGPT', 32);

  assert.equal(iconData.src, 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32');
  assert.equal(iconData.fallbackSrc, '');
  assert.equal(iconData.fallbackLabel, 'C');
});

test('getFallbackLabel derives stable initials from labels and hosts', () => {
  assert.equal(getFallbackLabel('GitHub Issues', 'github.com'), 'GI');
  assert.equal(getFallbackLabel('', 'www.wikipedia.org'), 'WI');
  assert.equal(getGoogleFaviconUrl('github.com', 16), 'https://www.google.com/s2/favicons?domain=github.com&sz=16');
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
  assert.match(iconData.sources[1], /google\.com\/s2\/favicons/);
});
