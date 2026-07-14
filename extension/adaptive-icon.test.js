'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeAdaptiveIconPixels,
  classifyAdaptiveIconAnalysis,
  createAdaptiveIconViewModel,
  getAdaptiveIconPlacement,
  getAdaptiveIconSurface,
  normalizeAdaptiveIconMetadata,
  normalizeAdaptiveIconPresentation,
  resolveAdaptiveIconTreatment,
} = require('./adaptive-icon.js');

function makeImageData(width, height, isOccupied) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = 40;
      data[offset + 1] = 80;
      data[offset + 2] = 120;
      data[offset + 3] = isOccupied(x, y) ? 255 : 0;
    }
  }
  return { width, height, data };
}

function isInsideCircle(width, height, x, y, inset = 0) {
  const radiusX = (width - (inset * 2)) / 2;
  const radiusY = (height - (inset * 2)) / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  return ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1;
}

function isInsideRoundedSquare(size, x, y, inset = 2, radius = 6) {
  const min = inset;
  const max = size - inset - 1;
  if (x < min || x > max || y < min || y > max) return false;
  if ((x >= min + radius && x <= max - radius)
    || (y >= min + radius && y <= max - radius)) {
    return true;
  }
  const cornerX = x < size / 2 ? min + radius : max - radius;
  const cornerY = y < size / 2 ? min + radius : max - radius;
  return ((x - cornerX) ** 2) + ((y - cornerY) ** 2) <= radius ** 2;
}

test('adaptive icon analysis rejects malformed input', () => {
  assert.equal(analyzeAdaptiveIconPixels(null), null);
  assert.equal(analyzeAdaptiveIconPixels({ width: 4, height: 4, data: [] }), null);
});

test('centered transparent marks resolve to glyph treatment', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(16, 16, (x, y) => x >= 4 && x < 12 && y >= 4 && y < 12)
  );

  assert.equal(analysis.alphaCoverage, 0.25);
  assert.equal(analysis.edgeCoverage, 0);
  assert.equal(analysis.cornerCoverage, 0);
  assert.deepEqual(analysis.contentBounds, {
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5,
  });
  assert.equal(classifyAdaptiveIconAnalysis(analysis), 'glyph');
});

test('edge-to-edge opaque icons resolve to tile treatment', () => {
  const analysis = analyzeAdaptiveIconPixels(makeImageData(12, 12, () => true));
  assert.equal(analysis.alphaCoverage, 1);
  assert.equal(analysis.edgeCoverage, 1);
  assert.equal(analysis.cornerCoverage, 1);
  assert.equal(analysis.silhouette.square, 1);
  assert.equal(classifyAdaptiveIconAnalysis(analysis), 'tile');
});

test('transparent rounded-square brand artwork resolves to tile treatment', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(32, 32, (x, y) => isInsideRoundedSquare(32, x, y))
  );
  assert.ok(analysis.silhouette.roundedSquare >= 0.9);
  assert.equal(classifyAdaptiveIconAnalysis(analysis), 'tile');
});

test('intrinsic circular artwork resolves to disc treatment', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(32, 32, (x, y) => isInsideCircle(32, 32, x, y, 3))
  );
  assert.ok(analysis.silhouette.circle >= 0.88);
  assert.equal(classifyAdaptiveIconAnalysis(analysis), 'disc');
});

test('edge-touching irregular artwork preserves the original treatment', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(16, 16, (x, y) => x < 4 || y < 4)
  );
  assert.equal(classifyAdaptiveIconAnalysis(analysis), 'original');
});

test('metadata normalization recomputes treatment and rejects invalid versions', () => {
  const analysis = analyzeAdaptiveIconPixels(makeImageData(8, 8, () => true));
  assert.equal(normalizeAdaptiveIconMetadata({ ...analysis, treatment: 'glyph' }).treatment, 'tile');
  assert.equal(normalizeAdaptiveIconMetadata({ ...analysis, v: 1 }), null);
});

test('explicit presentation overrides automatic analysis', () => {
  const fillAnalysis = analyzeAdaptiveIconPixels(makeImageData(8, 8, () => true));
  assert.equal(normalizeAdaptiveIconPresentation('unknown'), 'auto');
  assert.equal(resolveAdaptiveIconTreatment({
    presentation: 'glyph',
    sourceKind: 'site',
    adaptiveIcon: fillAnalysis,
  }), 'glyph');
  assert.equal(resolveAdaptiveIconTreatment({
    presentation: 'auto',
    sourceKind: 'site',
    adaptiveIcon: fillAnalysis,
  }), 'tile');
  assert.equal(resolveAdaptiveIconTreatment({
    presentation: 'fill',
    sourceKind: 'site',
    adaptiveIcon: null,
  }), 'tile');
});

test('fallbacks and legacy rounded masks remain conservative', () => {
  const fillAnalysis = analyzeAdaptiveIconPixels(makeImageData(8, 8, () => true));
  assert.equal(resolveAdaptiveIconTreatment({
    presentation: 'fill',
    sourceKind: 'fallback',
    adaptiveIcon: fillAnalysis,
  }), 'glyph');
  assert.equal(resolveAdaptiveIconTreatment({
    presentation: 'auto',
    sourceKind: 'site',
    iconMask: 'rounded',
    adaptiveIcon: fillAnalysis,
  }), 'original');
});

test('glyph placement enlarges padded art without excessive optical offset', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(20, 20, (x, y) => x >= 8 && x < 14 && y >= 6 && y < 14)
  );
  const placement = getAdaptiveIconPlacement(analysis, 'glyph');
  assert.ok(placement.scale > 1);
  assert.ok(Math.abs(placement.offsetX) <= 0.06);
  assert.ok(Math.abs(placement.offsetY) <= 0.06);
});

test('tile and disc placement normalize optical size without unsafe enlargement', () => {
  const tileAnalysis = analyzeAdaptiveIconPixels(
    makeImageData(32, 32, (x, y) => isInsideRoundedSquare(32, x, y, 4, 5))
  );
  const discAnalysis = analyzeAdaptiveIconPixels(
    makeImageData(32, 32, (x, y) => isInsideCircle(32, 32, x, y, 4))
  );
  const tilePlacement = getAdaptiveIconPlacement(tileAnalysis, 'tile');
  const discPlacement = getAdaptiveIconPlacement(discAnalysis, 'disc');

  assert.ok(tilePlacement.scale > 1 && tilePlacement.scale <= 1.5);
  assert.ok(discPlacement.scale > 1 && discPlacement.scale <= 1.5);
});

test('surface model separates artwork fitting from plate shape', () => {
  assert.deepEqual(getAdaptiveIconSurface('glyph'), {
    plateShape: 'circle',
    artworkFit: 'contain',
  });
  assert.deepEqual(getAdaptiveIconSurface('tile'), {
    plateShape: 'none',
    artworkFit: 'cover',
  });
  assert.deepEqual(getAdaptiveIconSurface('disc'), {
    plateShape: 'none',
    artworkFit: 'contain',
  });
});

test('view model centralizes source and treatment classes', () => {
  const analysis = analyzeAdaptiveIconPixels(
    makeImageData(16, 16, (x, y) => x >= 4 && x < 12 && y >= 4 && y < 12)
  );
  assert.deepEqual(createAdaptiveIconViewModel({
    iconPresentation: 'auto',
    iconKind: 'site',
    iconMask: 'none',
    hasPrimaryIcon: true,
    adaptiveIcon: analysis,
  }), {
    requestedPresentation: 'auto',
    treatment: 'glyph',
    sourceKind: 'site',
    hasLegacyRoundedMask: false,
    analysisAvailable: true,
    plateShape: 'circle',
    artworkFit: 'contain',
    cardClass: 'has-icon-treatment-glyph has-icon-plate-circle has-icon-fit-contain',
    placement: {
      scale: 1.4,
      offsetX: 0,
      offsetY: 0,
    },
  });
});
