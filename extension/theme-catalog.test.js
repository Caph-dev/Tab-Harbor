'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./theme-catalog.js');

const catalog = globalThis.TabHarborThemeCatalog;

function getRelativeLuminance(hex) {
  const channels = String(hex).slice(1).match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map(value => (
    value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function getContrastRatio(first, second) {
  const lighter = Math.max(getRelativeLuminance(first), getRelativeLuminance(second));
  const darker = Math.min(getRelativeLuminance(first), getRelativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test('theme catalog exposes the eight curated Tab Harbor styles', () => {
  assert.deepEqual(catalog.STYLE_ORDER, [
    'paper-desk',
    'ivory-index',
    'harbor-mist',
    'clay-notes',
    'botanical-folio',
    'porcelain-atlas',
    'nocturne-observatory',
    'vermilion-seal',
  ]);
});

test('every style provides complete light and dark tone tokens', () => {
  for (const styleId of catalog.STYLE_ORDER) {
    const style = catalog.getStyle(styleId);
    assert.ok(style.name, `${styleId} needs a name`);
    assert.ok(style.nameKey, `${styleId} needs a localized name key`);
    assert.ok(style.meta, `${styleId} needs metadata`);
    assert.ok(style.metaKey, `${styleId} needs a localized metadata key`);

    for (const tone of ['light', 'dark']) {
      for (const token of catalog.REQUIRED_TONE_TOKENS) {
        assert.ok(style[tone][token], `${styleId}.${tone} is missing ${token}`);
      }
    }
  }
});

test('style metadata text meets normal-text contrast in every tone', () => {
  for (const styleId of catalog.STYLE_ORDER) {
    const style = catalog.getStyle(styleId);
    for (const tone of ['light', 'dark']) {
      const contrast = getContrastRatio(
        style[tone]['--th-color-text-secondary'],
        style[tone]['--card-bg']
      );
      assert.ok(
        contrast >= 4.5,
        `${styleId}.${tone} metadata contrast is ${contrast.toFixed(2)}:1`
      );
    }
  }
});

test('every style provides the structural tokens used by the dashboard', () => {
  const requiredStyleTokens = [
    '--th-font-ui',
    '--th-font-display',
    '--th-font-section',
    '--th-container-max',
    '--th-container-padding-x',
    '--th-column-gap',
    '--th-section-gap',
    '--th-card-gap',
    '--th-item-padding-y',
    '--th-item-padding-x',
    '--th-panel-radius',
    '--th-card-radius',
    '--th-control-radius',
    '--th-field-radius',
    '--th-border-width',
    '--th-item-shadow',
    '--th-item-shadow-hover',
    '--th-floating-shadow',
    '--th-hover-lift',
    '--th-divider-opacity',
  ];

  for (const styleId of catalog.STYLE_ORDER) {
    const style = catalog.getStyle(styleId);
    for (const token of requiredStyleTokens) {
      assert.ok(
        String(style.tokens[token] || '').trim(),
        `${styleId} is missing ${token}`
      );
    }
  }
});

test('style geometry maps to the shared radius and border scales', () => {
  const sharedRadius = /^var\(--th-radius-(?:sm|md|lg|xl|pill)\)$/;

  for (const styleId of catalog.STYLE_ORDER) {
    const tokens = catalog.getStyle(styleId).tokens;
    assert.equal(tokens['--th-border-width'], 'var(--th-border-width-hairline)');

    for (const token of [
      '--th-panel-radius',
      '--th-card-radius',
      '--th-control-radius',
      '--th-field-radius',
    ]) {
      assert.match(
        tokens[token],
        sharedRadius,
        `${styleId}.${token} uses an off-scale radius`
      );
    }
  }
});

test('all theme typography roles resolve to serif families', () => {
  for (const styleId of catalog.STYLE_ORDER) {
    const tokens = catalog.getStyle(styleId).tokens;
    for (const token of ['--th-font-ui', '--th-font-display', '--th-font-section']) {
      assert.doesNotMatch(tokens[token], /Public Sans|sans-serif/);
      assert.match(tokens[token], /serif|--th-font-serif/);
    }
  }
});

test('ivory index uses a serif family across display, section, and UI roles', () => {
  const ivory = catalog.getStyle('ivory-index');

  for (const token of ['--th-font-ui', '--th-font-display', '--th-font-section']) {
    assert.match(ivory.tokens[token], /serif/);
    assert.doesNotMatch(ivory.tokens[token], /Public Sans|sans-serif/);
  }
  assert.equal(ivory.tokens['--th-display-weight'], '500');
});

test('legacy palette names resolve to their upgraded style identities', () => {
  assert.equal(catalog.normalizeStyleId('paper'), 'paper-desk');
  assert.equal(catalog.normalizeStyleId('ivory'), 'ivory-index');
  assert.equal(catalog.normalizeStyleId('mist'), 'harbor-mist');
  assert.equal(catalog.normalizeStyleId('blush'), 'clay-notes');
  assert.equal(catalog.resolveKnownStyleId('editorial-grid'), 'porcelain-atlas');
  assert.equal(catalog.resolveKnownStyleId('archive-ledger'), 'botanical-folio');
  assert.equal(catalog.normalizeStyleId('editorial'), 'porcelain-atlas');
  assert.equal(catalog.normalizeStyleId('archive'), 'botanical-folio');
  assert.equal(catalog.normalizeStyleId('unknown'), 'paper-desk');
  assert.equal(catalog.resolveKnownStyleId('unknown'), null);
});

test('theme preview describes page, surface, accent, ink, and dark material', () => {
  const preview = catalog.getPreviewStyle('nocturne-observatory');
  assert.match(preview, /--theme-paper:/);
  assert.match(preview, /--theme-surface:/);
  assert.match(preview, /--theme-accent:/);
  assert.match(preview, /--theme-ink:/);
  assert.match(preview, /--theme-dark:/);
});
