'use strict';

(function attachAdaptiveIcon(globalScope) {
  const ANALYSIS_VERSION = 2;
  const ALPHA_THRESHOLD = 24;
  const VALID_PRESENTATIONS = new Set(['auto', 'original', 'glyph', 'fill']);
  const VALID_TREATMENTS = new Set(['original', 'glyph', 'tile', 'disc']);

  function clampRatio(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(1, Math.max(0, numeric));
  }

  function roundRatio(value) {
    return Math.round(clampRatio(value) * 1000) / 1000;
  }

  function normalizeAdaptiveIconPresentation(value) {
    const presentation = String(value || '').trim();
    return VALID_PRESENTATIONS.has(presentation) ? presentation : 'auto';
  }

  function isImageDataLike(imageData) {
    const width = Number(imageData?.width);
    const height = Number(imageData?.height);
    const data = imageData?.data;
    return Number.isInteger(width)
      && width > 0
      && Number.isInteger(height)
      && height > 0
      && data
      && typeof data.length === 'number'
      && data.length >= width * height * 4;
  }

  function getPatchCoverage(imageData, startX, startY, patchSize) {
    const { width, height, data } = imageData;
    let occupied = 0;
    let total = 0;

    for (let y = startY; y < Math.min(height, startY + patchSize); y += 1) {
      for (let x = startX; x < Math.min(width, startX + patchSize); x += 1) {
        total += 1;
        if (data[((y * width) + x) * 4 + 3] >= ALPHA_THRESHOLD) occupied += 1;
      }
    }

    return total ? occupied / total : 0;
  }

  function isInsideRoundedSquare(x, y, radius = 0.2) {
    if ((x >= radius && x <= 1 - radius) || (y >= radius && y <= 1 - radius)) {
      return true;
    }
    const cornerX = x < 0.5 ? radius : 1 - radius;
    const cornerY = y < 0.5 ? radius : 1 - radius;
    return ((x - cornerX) ** 2) + ((y - cornerY) ** 2) <= radius ** 2;
  }

  function getSilhouetteSimilarity(imageData, bounds, shape) {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 0;
    const { width, data } = imageData;
    let actualCount = 0;
    let expectedCount = 0;
    let intersection = 0;

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const normalizedX = (x - bounds.minX + 0.5) / bounds.width;
        const normalizedY = (y - bounds.minY + 0.5) / bounds.height;
        const actual = data[((y * width) + x) * 4 + 3] >= ALPHA_THRESHOLD;
        const expected = shape === 'circle'
          ? (((normalizedX - 0.5) / 0.5) ** 2) + (((normalizedY - 0.5) / 0.5) ** 2) <= 1
          : shape === 'rounded-square'
            ? isInsideRoundedSquare(normalizedX, normalizedY)
            : true;

        if (actual) actualCount += 1;
        if (expected) expectedCount += 1;
        if (actual && expected) intersection += 1;
      }
    }

    const union = actualCount + expectedCount - intersection;
    return union ? intersection / union : 0;
  }

  function analyzeAdaptiveIconPixels(imageData) {
    if (!isImageDataLike(imageData)) return null;

    const { width, height, data } = imageData;
    const edgeBand = Math.max(1, Math.round(Math.min(width, height) * 0.125));
    const cornerPatch = Math.max(1, Math.round(Math.min(width, height) * 0.16));
    let occupied = 0;
    let edgeOccupied = 0;
    let edgeTotal = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let weightedX = 0;
    let weightedY = 0;
    let alphaWeight = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[((y * width) + x) * 4 + 3];
        const isEdge = x < edgeBand
          || x >= width - edgeBand
          || y < edgeBand
          || y >= height - edgeBand;
        if (isEdge) edgeTotal += 1;
        if (alpha < ALPHA_THRESHOLD) continue;

        occupied += 1;
        if (isEdge) edgeOccupied += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        weightedX += x * alpha;
        weightedY += y * alpha;
        alphaWeight += alpha;
      }
    }

    const cornerCoverages = [
      getPatchCoverage(imageData, 0, 0, cornerPatch),
      getPatchCoverage(imageData, width - cornerPatch, 0, cornerPatch),
      getPatchCoverage(imageData, 0, height - cornerPatch, cornerPatch),
      getPatchCoverage(imageData, width - cornerPatch, height - cornerPatch, cornerPatch),
    ];
    const occupiedCorners = cornerCoverages.filter(value => value >= 0.5).length;
    const hasContent = occupied > 0;
    const boundsWidth = hasContent ? maxX - minX + 1 : 0;
    const boundsHeight = hasContent ? maxY - minY + 1 : 0;
    const pixelBounds = hasContent ? {
      minX,
      minY,
      maxX,
      maxY,
      width: boundsWidth,
      height: boundsHeight,
    } : null;

    return {
      v: ANALYSIS_VERSION,
      width,
      height,
      alphaCoverage: roundRatio(occupied / (width * height)),
      edgeCoverage: roundRatio(edgeTotal ? edgeOccupied / edgeTotal : 0),
      cornerCoverage: roundRatio(occupiedCorners / 4),
      contentBounds: hasContent ? {
        x: roundRatio(minX / width),
        y: roundRatio(minY / height),
        width: roundRatio(boundsWidth / width),
        height: roundRatio(boundsHeight / height),
      } : null,
      visualCenter: hasContent && alphaWeight ? {
        x: roundRatio((weightedX / alphaWeight) / Math.max(1, width - 1)),
        y: roundRatio((weightedY / alphaWeight) / Math.max(1, height - 1)),
      } : null,
      silhouette: hasContent ? {
        circle: roundRatio(getSilhouetteSimilarity(imageData, pixelBounds, 'circle')),
        roundedSquare: roundRatio(getSilhouetteSimilarity(imageData, pixelBounds, 'rounded-square')),
        square: roundRatio(getSilhouetteSimilarity(imageData, pixelBounds, 'square')),
      } : null,
    };
  }

  function classifyAdaptiveIconAnalysis(analysis) {
    const normalized = normalizeAdaptiveIconMetadata(analysis, false);
    if (!normalized || !normalized.contentBounds) return 'original';
    const boundsArea = normalized.contentBounds.width * normalized.contentBounds.height;
    const aspectRatio = normalized.contentBounds.width / normalized.contentBounds.height;
    const hasBalancedBounds = aspectRatio >= 0.82 && aspectRatio <= 1.22;
    const circleSimilarity = normalized.silhouette?.circle || 0;
    const tileSimilarity = Math.max(
      normalized.silhouette?.roundedSquare || 0,
      normalized.silhouette?.square || 0
    );

    if (hasBalancedBounds
      && boundsArea >= 0.3
      && circleSimilarity >= 0.88
      && circleSimilarity >= tileSimilarity + 0.025) {
      return 'disc';
    }
    if (hasBalancedBounds
      && boundsArea >= 0.42
      && tileSimilarity >= 0.9
      && tileSimilarity >= circleSimilarity + 0.025) {
      return 'tile';
    }
    if (normalized.alphaCoverage <= 0.72
      && normalized.edgeCoverage <= 0.35
      && normalized.cornerCoverage <= 0.25
      && boundsArea >= 0.04) {
      return 'glyph';
    }
    return 'original';
  }

  function normalizePoint(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      x: roundRatio(value.x),
      y: roundRatio(value.y),
    };
  }

  function normalizeBounds(value) {
    if (!value || typeof value !== 'object') return null;
    const width = roundRatio(value.width);
    const height = roundRatio(value.height);
    if (!width || !height) return null;
    return {
      x: roundRatio(value.x),
      y: roundRatio(value.y),
      width,
      height,
    };
  }

  function normalizeSilhouette(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      circle: roundRatio(value.circle),
      roundedSquare: roundRatio(value.roundedSquare),
      square: roundRatio(value.square),
    };
  }

  function normalizeAdaptiveIconMetadata(value, includeTreatment = true) {
    if (!value || Number(value.v) !== ANALYSIS_VERSION) return null;
    const width = Math.round(Number(value.width));
    const height = Math.round(Number(value.height));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }

    const normalized = {
      v: ANALYSIS_VERSION,
      width,
      height,
      alphaCoverage: roundRatio(value.alphaCoverage),
      edgeCoverage: roundRatio(value.edgeCoverage),
      cornerCoverage: roundRatio(value.cornerCoverage),
      contentBounds: normalizeBounds(value.contentBounds),
      visualCenter: normalizePoint(value.visualCenter),
      silhouette: normalizeSilhouette(value.silhouette),
    };
    if (includeTreatment) {
      normalized.treatment = classifyAdaptiveIconAnalysis(normalized);
    }
    return normalized;
  }

  function getAdaptiveIconPlacement(analysis, treatment = 'original') {
    const normalized = normalizeAdaptiveIconMetadata(analysis);
    if (!normalized || !normalized.contentBounds || !['glyph', 'tile', 'disc'].includes(treatment)) {
      return { scale: 1, offsetX: 0, offsetY: 0 };
    }

    const bounds = normalized.contentBounds;
    const aspectRatio = bounds.width / bounds.height;
    const targetWidth = treatment === 'glyph'
      ? (aspectRatio > 1.8 ? 0.78 : 0.7)
      : treatment === 'disc' ? 0.9 : 0.92;
    const targetHeight = treatment === 'glyph'
      ? (aspectRatio < 0.56 ? 0.76 : aspectRatio > 1.8 ? 0.48 : 0.7)
      : treatment === 'disc' ? 0.9 : 0.92;
    const maxScale = treatment === 'glyph' ? 2.4 : 1.5;
    const scale = Math.min(targetWidth / bounds.width, targetHeight / bounds.height, maxScale);
    const center = normalized.visualCenter || {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };

    return {
      scale: Math.round(scale * 1000) / 1000,
      offsetX: Math.round(Math.max(-0.06, Math.min(0.06, 0.5 - center.x)) * 1000) / 1000,
      offsetY: Math.round(Math.max(-0.06, Math.min(0.06, 0.5 - center.y)) * 1000) / 1000,
    };
  }

  function resolveAdaptiveIconTreatment(input = {}) {
    const presentation = normalizeAdaptiveIconPresentation(input.presentation);
    const sourceKind = String(input.sourceKind || 'fallback');
    if (sourceKind === 'glyph' || sourceKind === 'fallback') return 'glyph';
    if (presentation !== 'auto') {
      const explicitTreatment = presentation === 'fill' ? 'tile' : presentation;
      return VALID_TREATMENTS.has(explicitTreatment) ? explicitTreatment : 'original';
    }
    if (input.iconMask === 'rounded') return 'original';
    const metadata = normalizeAdaptiveIconMetadata(input.adaptiveIcon);
    if (sourceKind === 'site' && metadata) return metadata.treatment;
    return 'original';
  }

  function getAdaptiveIconSurface(treatment, iconMask = 'none') {
    if (treatment === 'glyph') {
      return { plateShape: 'circle', artworkFit: 'contain' };
    }
    if (treatment === 'tile') {
      return { plateShape: 'none', artworkFit: 'cover' };
    }
    if (treatment === 'disc') {
      return { plateShape: 'none', artworkFit: 'contain' };
    }
    return {
      plateShape: iconMask === 'rounded' ? 'rounded-square' : 'rounded-square',
      artworkFit: 'contain',
    };
  }

  function createAdaptiveIconViewModel(input = {}) {
    const requestedPresentation = normalizeAdaptiveIconPresentation(input.iconPresentation);
    const iconKind = String(input.iconKind || '');
    const sourceKind = iconKind === 'image'
      ? 'custom-image'
      : iconKind === 'svg'
        ? 'custom-svg'
        : iconKind === 'glyph' || input.hasGlyph
          ? 'glyph'
          : input.hasPrimaryIcon
            ? 'site'
            : 'fallback';
    const treatment = resolveAdaptiveIconTreatment({
      presentation: requestedPresentation,
      sourceKind,
      iconMask: input.iconMask,
      adaptiveIcon: input.adaptiveIcon,
    });
    const placement = getAdaptiveIconPlacement(input.adaptiveIcon, treatment);
    const surface = getAdaptiveIconSurface(treatment, input.iconMask);

    return {
      requestedPresentation,
      treatment,
      sourceKind,
      hasLegacyRoundedMask: input.iconMask === 'rounded',
      analysisAvailable: Boolean(normalizeAdaptiveIconMetadata(input.adaptiveIcon)),
      plateShape: surface.plateShape,
      artworkFit: surface.artworkFit,
      cardClass: [
        `has-icon-treatment-${treatment}`,
        `has-icon-plate-${surface.plateShape}`,
        `has-icon-fit-${surface.artworkFit}`,
      ].join(' '),
      placement,
    };
  }

  const api = {
    ANALYSIS_VERSION,
    analyzeAdaptiveIconPixels,
    classifyAdaptiveIconAnalysis,
    createAdaptiveIconViewModel,
    getAdaptiveIconPlacement,
    getAdaptiveIconSurface,
    normalizeAdaptiveIconMetadata,
    normalizeAdaptiveIconPresentation,
    resolveAdaptiveIconTreatment,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborAdaptiveIcon = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
