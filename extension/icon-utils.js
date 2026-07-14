'use strict';

(function attachIconUtils(globalScope) {
  function getHostname(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function getGoogleFaviconUrl(hostname, size = 16) {
    if (!hostname) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
  }

  function getFaviconRequestSize(size = 16) {
    const cssSize = Math.max(16, Number(size) || 16);
    const pixelRatio = Math.max(1, Number(globalScope.devicePixelRatio) || 1);
    return Math.min(64, cssSize * pixelRatio) > 32 ? 64 : 32;
  }

  function getChromeFaviconUrl(pageUrl, size = 16) {
    const value = String(pageUrl || '').trim();
    const getUrl = globalScope.chrome?.runtime?.getURL;
    if (!value || typeof getUrl !== 'function') return '';

    try {
      const page = new URL(value);
      if (!['http:', 'https:'].includes(page.protocol)) return '';
      const faviconUrl = new URL(getUrl('/_favicon/'));
      faviconUrl.searchParams.set('pageUrl', page.toString());
      faviconUrl.searchParams.set('size', String(getFaviconRequestSize(size)));
      return faviconUrl.toString();
    } catch {
      return '';
    }
  }

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlAttribute(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getFallbackLabel(label, hostname = '') {
    const cleanLabel = (label || '').trim();
    if (cleanLabel) {
      const tokens = cleanLabel
        .split(/[\s./:_-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(token => token[0]?.toUpperCase() || '');
      const joined = tokens.join('');
      if (joined) return joined;
    }

    const cleanHost = hostname.replace(/^www\./, '');
    return (cleanHost.slice(0, 2) || '?').toUpperCase();
  }

  function getIconSources({ favIconUrl = '', url = '' } = {}, size = 16) {
    const hostname = getHostname(url);
    const sources = [];

    const faviconCache = globalScope.TabHarborFaviconCache;
    const liveFaviconUrl = faviconCache?.isUsableLiveFaviconUrl?.(favIconUrl)
      ? favIconUrl
      : (faviconCache?.isPersistableFaviconUrl?.(favIconUrl) ? favIconUrl : '');

    if (liveFaviconUrl) sources.push(liveFaviconUrl);
    const chromeFaviconUrl = getChromeFaviconUrl(url, size);
    if (chromeFaviconUrl) sources.push(chromeFaviconUrl);

    const base = { hostname, sources, adaptiveIcon: null };
    if (!faviconCache?.enrichIconSources) {
      return base;
    }

    const enriched = faviconCache.enrichIconSources(base, size);
    if (faviconCache.scheduleFaviconWarmup) {
      faviconCache.scheduleFaviconWarmup({ url, favIconUrl: liveFaviconUrl });
    } else if (favIconUrl && faviconCache.rememberFaviconCandidate) {
      faviconCache.rememberFaviconCandidate({ url, favIconUrl });
    }
    return enriched;
  }

  function getGroupIcon(group, label, size = 32) {
    const tabs = group?.tabs || [];
    const preferredTab = tabs.find(tab => tab?.favIconUrl) || tabs[0] || {};
    const { hostname, sources, adaptiveIcon } = getIconSources(preferredTab, size);

    return {
      hostname,
      src: sources[0] || '',
      fallbackSrc: sources[1] || '',
      fallbackLabel: getFallbackLabel(label, hostname),
      adaptiveIcon: adaptiveIcon || null,
    };
  }

  const api = {
    escapeHtml,
    escapeHtmlAttribute,
    getChromeFaviconUrl,
    getFallbackLabel,
    getFaviconRequestSize,
    getGoogleFaviconUrl,
    getGroupIcon,
    getHostname,
    getIconSources,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabOutIconUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
