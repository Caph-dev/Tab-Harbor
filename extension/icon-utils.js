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
    if (hostname) sources.push(getGoogleFaviconUrl(hostname, size));

    const base = { hostname, sources };
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
    const { hostname, sources } = getIconSources(preferredTab, size);

    return {
      hostname,
      src: sources[0] || '',
      fallbackSrc: sources[1] || '',
      fallbackLabel: getFallbackLabel(label, hostname),
    };
  }

  const api = {
    escapeHtml,
    escapeHtmlAttribute,
    getFallbackLabel,
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
