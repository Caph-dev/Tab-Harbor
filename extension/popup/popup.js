'use strict';

const popupTheme = globalThis.TabOutThemeControls || {};
const popupIcons = globalThis.TabOutIconUtils || {};
const popupAdaptiveIcons = globalThis.TabHarborAdaptiveIcon || {};
const popupListOrder = globalThis.TabOutListOrder || {};
const popupSessionGroups = globalThis.TabOutSessionGroups || {};
const popupGroupOrder = globalThis.TabOutGroupOrder || {};
const popupI18n = globalThis.TabHarborI18n || {};

const SESSION_GROUPS_KEY = 'sessionGroups';
const GROUP_ORDER_KEY = 'groupOrder';
const GROUP_TAB_ORDER_KEY = 'groupTabOrder';
const POPUP_SHORTCUT_ICON_DEFAULT_SIZE = 32;
const POPUP_SHORTCUT_ICON_MASK_SIZE = 36;
const POPUP_SHORTCUT_ICON_DEFAULT_RADIUS = 0;
const POPUP_SHORTCUT_ICON_MASK_RADIUS = 10;
const POPUP_SHORTCUT_ICON_MIN_SIZE = 24;
const POPUP_SHORTCUT_ICON_MAX_SIZE = 40;
const POPUP_SHORTCUT_ICON_MIN_RADIUS = 0;
const POPUP_SHORTCUT_ICON_MAX_RADIUS = 20;
const POPUP_REFRESH_SCOPE = Object.freeze({
  SHORTCUTS: 'shortcuts',
  TABS: 'tabs',
  THEME: 'theme',
  FAVICON: 'favicon',
  LANGUAGE: 'language',
});
const POPUP_INITIAL_REFRESH_SCOPES = [
  POPUP_REFRESH_SCOPE.SHORTCUTS,
  POPUP_REFRESH_SCOPE.THEME,
  POPUP_REFRESH_SCOPE.FAVICON,
  POPUP_REFRESH_SCOPE.LANGUAGE,
];
const POPUP_FULL_REFRESH_SCOPES = Object.values(POPUP_REFRESH_SCOPE);

const popupState = {
  view: 'shortcuts',
  openTabs: [],
  quickShortcuts: [],
  tabGroups: [],
  sessionGroups: { groups: [], assignments: {} },
  groupOrder: { sessionOrder: [], pinnedOrder: [], pinEnabled: false },
  groupTabOrder: {},
};

// Test exposure
globalThis.popupState = popupState;
globalThis.buildPopupTabGroups = buildPopupTabGroups;
globalThis.getGroupDisplayLabel = getGroupDisplayLabel;
globalThis.escapeAttr = escapeAttr;
globalThis.friendlyDomain = friendlyDomain;
globalThis.stripTitleNoise = stripTitleNoise;
globalThis.getTabLabel = getTabLabel;
globalThis.isLandingPage = isLandingPage;
globalThis.matchCustomGroup = matchCustomGroup;
globalThis.renderShortcutCard = renderShortcutCard;
globalThis.renderTabGroup = renderTabGroup;
globalThis.renderGroupNav = renderGroupNav;
globalThis._resetPopupState = () => {
  popupState.openTabs = [];
  popupState.tabGroups = [];
  popupState.sessionGroups = { groups: [], assignments: {} };
  popupState.groupOrder = { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = {};
  popupState.quickShortcuts = [];
};
globalThis._skipLoadPopupState = false;
globalThis._popupIcons = popupIcons;

const POPUP_REFRESH_KEYS = new Set([
  'quickShortcuts',
  'tabHarbor.shortcut.order',
  'tabHarbor.favicon.cache',
  'tabHarbor.favicon.index',
  'sessionGroups',
  'groupOrder',
  'groupTabOrder',
  'themePreferences',
  'languagePreference',
]);

let popupRefreshTimer = null;
let popupRefreshInFlight = null;
const popupPendingRefreshScopes = new Set();
const popupQueuedRefreshScopes = new Set();

function addPopupRefreshScopes(target, scopes) {
  const values = scopes instanceof Set
    ? scopes
    : Array.isArray(scopes)
      ? scopes
      : [scopes];
  for (const scope of values) {
    if (scope) target.add(scope);
  }
  return target;
}

function normalizePopupRefreshScopes(scopes = POPUP_FULL_REFRESH_SCOPES) {
  return addPopupRefreshScopes(new Set(), scopes);
}

function escapeAttr(value = '') {
  return popupIcons.escapeHtmlAttribute ? popupIcons.escapeHtmlAttribute(value) : String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function friendlyDomain(domain) {
  const normalizedDomain = String(domain || '').trim();
  if (isNetworkAddressLabel(normalizedDomain)) return normalizedDomain;

  return normalizedDomain
    .replace(/^www\./, '')
    .replace(/\./g, ' ')
    .trim();
}

function isNetworkAddressLabel(domain) {
  const label = String(domain || '').trim();
  return /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(label)
    || /^localhost(?::\d+)?$/i.test(label)
    || /^\[[0-9a-f:]+\](?::\d+)?$/i.test(label);
}

function stripTitleNoise(title) {
  if (!title) return '';
  title = String(title);
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  const noiseSepMatch = title.match(/\s+[\|\-\u2010-\u2015\u00b7]\s+/);
  if (noiseSepMatch?.index > 0) {
    title = title.slice(0, noiseSepMatch.index);
  }
  title = title.replace(/\s*[\|\-\u2010-\u2015\u00b7]\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');
  const seps = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim();
    const suffixLow = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '';
  let hostname = '';
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return title || '';
  }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull' && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch' && titleIsUrl) {
    return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1] && titleIsUrl) {
      return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}

function getTabHostname(tab) {
  try {
    if (tab?.url?.startsWith('file://')) return 'local-files';
    const parsed = new URL(tab?.url || '');
    const hostname = parsed.hostname || '';
    if (isNetworkAddressLabel(hostname) && parsed.port) return parsed.host;
    return hostname;
  } catch {
    return '';
  }
}

function getTabLabel(tab = {}) {
  const url = tab.url || '';
  const hostname = getTabHostname(tab);
  const title = cleanTitle(
    smartTitle(stripTitleNoise(tab.title || ''), url),
    hostname
  );
  const titleLooksLikeUrl = title === url || /^[a-z][a-z0-9+.-]*:\/\//i.test(title);
  if (title && !titleLooksLikeUrl) return title;

  try {
    const parsed = new URL(url);
    const fallbackHost = isNetworkAddressLabel(parsed.hostname) && parsed.port
      ? parsed.host
      : (parsed.hostname || hostname);
    return friendlyDomain(fallbackHost) || url || 'Tab';
  } catch {
    return url || 'Tab';
  }
}

function clampPopupNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function normalizePopupShortcutIconSize(value, iconMask = 'none') {
  return clampPopupNumber(
    value,
    POPUP_SHORTCUT_ICON_MIN_SIZE,
    POPUP_SHORTCUT_ICON_MAX_SIZE,
    iconMask === 'rounded' ? POPUP_SHORTCUT_ICON_MASK_SIZE : POPUP_SHORTCUT_ICON_DEFAULT_SIZE
  );
}

function normalizePopupShortcutIconRadius(value, iconMask = 'none') {
  return clampPopupNumber(
    value,
    POPUP_SHORTCUT_ICON_MIN_RADIUS,
    POPUP_SHORTCUT_ICON_MAX_RADIUS,
    iconMask === 'rounded' ? POPUP_SHORTCUT_ICON_MASK_RADIUS : POPUP_SHORTCUT_ICON_DEFAULT_RADIUS
  );
}

function getPopupShortcutIconStylePreferences() {
  const getter = popupTheme.getQuickShortcutIconStylePreferences;
  if (typeof getter === 'function') {
    return getter();
  }
  return {
    iconSize: normalizePopupShortcutIconSize(undefined, 'none'),
    iconMaskRadius: normalizePopupShortcutIconRadius(undefined, 'rounded'),
  };
}

function getPopupShortcutIconStyleAttribute() {
  const style = getPopupShortcutIconStylePreferences();
  return `--shortcut-icon-size:${style.iconSize}px;--shortcut-icon-radius:${style.iconMaskRadius}px;`;
}

const filterTabs = popupTheme.filterRealTabs || (tabs => Array.isArray(tabs) ? tabs : []);

function getLandingPatterns() {
  const base = [
    { hostname: 'mail.google.com', test: (_p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
  ];
  const local = typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [];
  return [...base, ...local];
}

function isLandingPage(url) {
  try {
    const parsed = new URL(url);
    return getLandingPatterns().some(p => {
      const hostnameMatch = p.hostname
        ? parsed.hostname === p.hostname
        : p.hostnameEndsWith
          ? parsed.hostname.endsWith(p.hostnameEndsWith)
          : false;
      if (!hostnameMatch) return false;
      if (p.test)       return p.test(parsed.pathname, url);
      if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
      if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch { return false; }
}

function getCustomGroups() {
  return typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];
}

function matchCustomGroup(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return null;
    return getCustomGroups().find(r => {
      const hostMatch = r.hostname
        ? parsed.hostname === r.hostname
        : r.hostnameEndsWith
          ? parsed.hostname.endsWith(r.hostnameEndsWith)
          : false;
      if (!hostMatch) return false;
      if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
      return true;
    }) || null;
  } catch { return null; }
}

function normalizeGroupTabOrderState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .map(([groupKey, orderIds]) => [
        String(groupKey),
        Array.isArray(orderIds)
          ? [...new Set(orderIds.map(id => String(id)).filter(Boolean))]
          : [],
      ])
      .filter(([, orderIds]) => orderIds.length > 0)
  );
}

function reorderVisibleItemsByIds(items, orderIds, includeItem) {
  if (!Array.isArray(items)) return [];
  const list = items.slice();
  const shouldInclude = typeof includeItem === 'function' ? includeItem : () => true;
  const subset = list.filter(shouldInclude);
  const normalizedOrder = Array.isArray(orderIds) ? orderIds.map(id => String(id)).filter(Boolean) : [];
  if (!subset.length || subset.length !== normalizedOrder.length) return list;

  const subsetMap = new Map(subset.map(item => [String(item.id), item]));
  if (normalizedOrder.some(id => !subsetMap.has(id))) return list;

  let nextIndex = 0;
  return list.map(item => {
    if (!shouldInclude(item)) return item;
    const nextItem = subsetMap.get(normalizedOrder[nextIndex]);
    nextIndex += 1;
    return nextItem || item;
  });
}

function reorderGroupTabsByStoredUrls(tabs, groupKey) {
  const orderIds = popupState.groupTabOrder[String(groupKey)] || [];
  if (!Array.isArray(tabs) || !tabs.length || !orderIds.length) return Array.isArray(tabs) ? tabs.slice() : [];

  const wrappedTabs = tabs.map(tab => ({
    id: String(tab?.url || ''),
    tab,
  }));
  const subsetUrls = new Set(orderIds);
  const reordered = reorderVisibleItemsByIds(
    wrappedTabs,
    orderIds,
    item => subsetUrls.has(item.id)
  );
  return reordered.map(item => item.tab);
}

function getOrderedUniqueTabsForGroup(group) {
  const tabs = Array.isArray(group?.tabs) ? group.tabs : [];
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    const url = String(tab?.url || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    uniqueTabs.push(tab);
  }
  return reorderGroupTabsByStoredUrls(uniqueTabs, group?.domain);
}

async function loadPopupTabsState() {
  const [tabs, tabGroups, sgResult, goResult, groupTabOrderResult] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.storage.local.get(SESSION_GROUPS_KEY),
    chrome.storage.local.get(GROUP_ORDER_KEY),
    chrome.storage.local.get(GROUP_TAB_ORDER_KEY),
  ]);

  popupState.openTabs = filterTabs(tabs).map(tab => ({
    id: tab.id,
    url: tab.url || '',
    title: tab.title || '',
    favIconUrl: tab.favIconUrl || '',
    windowId: tab.windowId,
    active: Boolean(tab.active),
    groupId: tab.groupId,
  }));

  const tabsByGroupId = new Map();
  for (const tab of popupState.openTabs) {
    if (!tabsByGroupId.has(tab.groupId)) tabsByGroupId.set(tab.groupId, []);
    tabsByGroupId.get(tab.groupId).push(tab);
  }

  popupState.tabGroups = Array.isArray(tabGroups)
    ? tabGroups
        .map(group => ({
          id: group.id,
          title: group.title || '',
          color: group.color || '',
          collapsed: Boolean(group.collapsed),
          tabs: tabsByGroupId.get(group.id) || [],
        }))
        .filter(group => group.tabs.length > 0)
    : [];

  const normalizeFn = popupSessionGroups.normalizeSessionGroups;
  popupState.sessionGroups = normalizeFn ? normalizeFn(sgResult[SESSION_GROUPS_KEY]) : { groups: [], assignments: {} };

  const normalizeOrderFn = popupGroupOrder.normalizeGroupOrderState;
  popupState.groupOrder = normalizeOrderFn ? normalizeOrderFn(goResult[GROUP_ORDER_KEY]) : { sessionOrder: [], pinnedOrder: [], pinEnabled: false };
  popupState.groupTabOrder = normalizeGroupTabOrderState(groupTabOrderResult[GROUP_TAB_ORDER_KEY]);
}

async function loadPopupState({ skipTabs = false, skipShortcuts = false } = {}) {
  if (globalThis._skipLoadPopupState) return;
  const jobs = [];
  const shortcutsGetter = popupTheme.getQuickShortcuts;
  if (!skipShortcuts && typeof shortcutsGetter === 'function') {
    jobs.push(Promise.resolve(shortcutsGetter()).then(shortcuts => {
      popupState.quickShortcuts = shortcuts;
    }));
  }

  if (!skipTabs) jobs.push(loadPopupTabsState());
  await Promise.all(jobs);
}

function buildPopupTabGroups() {
  const { openTabs, sessionGroups, groupOrder } = popupState;

  const sessionGroupMap = Object.fromEntries(
    sessionGroups.groups.map(group => [
      group.id,
      { domain: `__session_group__:${group.id}`, label: group.name, tabs: [], kind: 'session', manualGroupId: group.id },
    ])
  );

  const groupMap = {};
  const landingTabs = [];
  const groupedTabIds = new Set();
  const markGrouped = tab => {
    if (tab?.id !== undefined && tab?.id !== null) groupedTabIds.add(String(tab.id));
  };
  const isGrouped = tab => tab?.id !== undefined && tab?.id !== null && groupedTabIds.has(String(tab.id));

  for (const tab of openTabs) {
    const assignedGroupId = sessionGroups.assignments[String(tab.id)];
    if (assignedGroupId && sessionGroupMap[assignedGroupId]) {
      sessionGroupMap[assignedGroupId].tabs.push(tab);
      markGrouped(tab);
      continue;
    }

    if (isLandingPage(tab.url)) {
      landingTabs.push(tab);
      markGrouped(tab);
      continue;
    }

    const customRule = matchCustomGroup(tab.url);
    if (customRule) {
      const key = customRule.groupKey;
      if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [], kind: 'custom' };
      groupMap[key].tabs.push(tab);
      markGrouped(tab);
      continue;
    }

    let hostname;
    try {
      hostname = tab.url.startsWith('file://') ? 'local-files' : new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (!hostname) continue;

    if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, label: hostname, tabs: [], kind: 'domain' };
    groupMap[hostname].tabs.push(tab);
    markGrouped(tab);
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', label: '__landing-pages__', tabs: landingTabs, kind: 'landing' };
  }

  for (const group of popupState.tabGroups || []) {
    const tabs = Array.isArray(group?.tabs) ? group.tabs.filter(tab => !isGrouped(tab)) : [];
    if (!tabs.length) continue;
    const key = `__chrome_group__:${group.id}`;
    groupMap[key] = {
      domain: key,
      label: group.title || 'Group',
      tabs,
      kind: 'chrome-group',
      color: group.color || '',
      collapsed: Boolean(group.collapsed),
      chromeGroupId: group.id,
    };
    tabs.forEach(markGrouped);
  }

  const landingHostnames = new Set(getLandingPatterns().map(p => p.hostname).filter(Boolean));
  const landingSuffixes = getLandingPatterns().map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }

  const sessionGroupsList = Object.values(sessionGroupMap).filter(g => g.tabs.length > 0);
  const automaticGroups = Object.values(groupMap);

  const sortedAutomatic = automaticGroups.sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const applyOrderFn = popupGroupOrder.applyGroupOrder;
  const orderedManual = applyOrderFn ? applyOrderFn(sessionGroupsList, groupOrder) : sessionGroupsList;
  const orderedAuto = applyOrderFn ? applyOrderFn(sortedAutomatic, groupOrder) : sortedAutomatic;

  return [...orderedManual, ...orderedAuto];
}

function renderPopupShortcuts() {
  const listEl = document.getElementById('popupShortcutsList');
  const emptyEl = document.getElementById('popupShortcutsEmpty');
  if (!listEl || !emptyEl) return;

  listEl.classList.add('is-entering');
  listEl.innerHTML = popupState.quickShortcuts.length
    ? popupState.quickShortcuts.map((s, i) => renderShortcutCard(s, i)).join('')
    : '';
  emptyEl.hidden = popupState.quickShortcuts.length > 0;

  requestAnimationFrame(() => requestAnimationFrame(() => listEl.classList.add('is-ready')));
}

function renderShortcutCard(shortcut, index) {
  const label = shortcut.label || shortcut.url;
  const iconKind = String(shortcut.iconKind || '');
  const iconData = popupIcons.getIconSources ? popupIcons.getIconSources({ url: shortcut.url }, 32) : { sources: [], hostname: '' };
  const safeUrl = escapeAttr(shortcut.url);
  const safeLabel = escapeAttr(label);
  const siteIconUrl = iconData.sources?.[0] || '';
  const siteFallbackUrl = iconData.sources?.[1] || '';
  const primaryIconUrl = iconKind === 'image'
    ? shortcut.icon
    : iconKind === 'svg'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shortcut.icon || '')}`
      : iconKind === 'glyph'
        ? ''
        : siteIconUrl;
  const glyph = iconKind === 'glyph' ? shortcut.icon : '';
  const iconErrorFallback = iconKind === 'image' || iconKind === 'svg'
    ? (siteIconUrl || siteFallbackUrl)
    : siteFallbackUrl;
  const safePrimaryIconUrl = escapeAttr(primaryIconUrl);
  const safeIconErrorFallback = escapeAttr(iconErrorFallback);
  const safeGlyph = escapeAttr(glyph);
  const fallbackLabel = popupIcons.getFallbackLabel ? popupIcons.getFallbackLabel(label, iconData.hostname) : label.slice(0, 1).toUpperCase();
  const iconMask = shortcut.iconMask === 'rounded' ? 'rounded' : 'none';
  const iconStyle = getPopupShortcutIconStyleAttribute();
  const iconSource = iconKind === 'image'
    ? 'custom-image'
    : iconKind === 'svg'
      ? 'custom-svg'
      : iconKind === 'glyph'
        ? 'glyph'
        : primaryIconUrl
          ? 'site'
          : 'fallback';
  const iconTone = popupTheme.getShortcutIconTone
    ? popupTheme.getShortcutIconTone(iconData.hostname)
    : 'neutral';
  const adaptiveViewModel = popupAdaptiveIcons.createAdaptiveIconViewModel
    ? popupAdaptiveIcons.createAdaptiveIconViewModel({
        iconPresentation: shortcut.iconPresentation,
        iconKind: iconKind || 'site',
        iconMask,
        hasPrimaryIcon: Boolean(primaryIconUrl),
        hasGlyph: Boolean(glyph),
        adaptiveIcon: iconData.adaptiveIcon,
      })
      : {
        requestedPresentation: 'auto',
        treatment: iconSource === 'glyph' || iconSource === 'fallback' ? 'glyph' : 'original',
        plateShape: iconSource === 'glyph' || iconSource === 'fallback' ? 'circle' : 'rounded-square',
        artworkFit: 'contain',
        cardClass: iconSource === 'glyph' || iconSource === 'fallback'
          ? 'has-icon-treatment-glyph has-icon-plate-circle has-icon-fit-contain'
          : 'has-icon-treatment-original has-icon-plate-rounded-square has-icon-fit-contain',
        placement: { scale: 1, offsetX: 0, offsetY: 0 },
      };
  const adaptiveStyle = `--adaptive-icon-scale:${adaptiveViewModel.placement.scale};--adaptive-icon-offset-x:${adaptiveViewModel.placement.offsetX * 100}%;--adaptive-icon-offset-y:${adaptiveViewModel.placement.offsetY * 100}%;`;

  return `
    <div class="quick-shortcut-card popup-shortcut-card ${adaptiveViewModel.cardClass}${iconMask === 'rounded' ? ' has-rounded-icon-mask' : ''}" data-icon-presentation="${adaptiveViewModel.requestedPresentation}" data-icon-treatment="${adaptiveViewModel.treatment}" data-icon-plate="${adaptiveViewModel.plateShape}" data-icon-fit="${adaptiveViewModel.artworkFit}" data-icon-source="${iconSource}" data-icon-tone="${iconTone}" style="--s:${index};${iconStyle}${adaptiveStyle}">
      <button class="quick-shortcut-open" type="button" data-action="open-popup-url" data-url="${safeUrl}" aria-label="${safeLabel}">
        <span class="quick-shortcut-icon-wrap">
          ${primaryIconUrl ? `<img class="quick-shortcut-icon${iconKind === 'image' ? ' quick-shortcut-icon-custom' : ''}" src="${safePrimaryIconUrl}" alt="" draggable="false" data-fallback-src="${safeIconErrorFallback}">` : ''}
          ${glyph ? `<span class="quick-shortcut-custom-glyph" aria-hidden="true">${safeGlyph}</span>` : ''}
          <span class="quick-shortcut-fallback"${primaryIconUrl || glyph ? ' style="display:none"' : ''}>${fallbackLabel}</span>
        </span>
        <span class="quick-shortcut-label">${safeLabel}</span>
      </button>
    </div>
  `;
}

function getGroupDisplayLabel(group) {
  const i18n = globalThis.TabHarborI18n || {};
  const t = i18n.t ? (key => i18n.t(key)) : (key => key);
  switch (group.kind) {
    case 'landing':   return t('homepagesLabel');
    case 'session':   return group.label;
    case 'chrome-group': return group.label;
    case 'ungrouped': return t('ungroupedLabel');
    default:          return friendlyDomain(group.domain) || group.domain;
  }
}

function renderGroupNav(group, index) {
  const label = getGroupDisplayLabel(group);
  const iconData = popupIcons.getGroupIcon ? popupIcons.getGroupIcon(group, label, 32) : { src: '', fallbackLabel: label.slice(0, 2).toUpperCase() };
  const fallbackLabel = escapeAttr(iconData.fallbackLabel || label.slice(0, 2).toUpperCase());
  const fallbackSrc = escapeAttr(iconData.fallbackSrc || '');
  return `
    <button class="group-nav-button" type="button" data-action="jump-popup-group" data-group-id="${escapeAttr(group.domain)}" aria-label="${escapeAttr(label)}" style="--s:${index}">
      ${iconData.src ? `<img class="group-nav-icon" src="${escapeAttr(iconData.src)}" alt="" draggable="false" data-fallback-src="${fallbackSrc}">` : ''}
      <span class="group-nav-fallback"${iconData.src ? ' style="display:none"' : ''}>${fallbackLabel}</span>
    </button>
  `;
}

function renderTabGroup(group, groupIndex) {
  const label = getGroupDisplayLabel(group);
  const rows = getOrderedUniqueTabsForGroup(group).map((tab, tabIndex) => {
    const title = getTabLabel(tab);
    const safeUrl = escapeAttr(tab.url || '');
    const safeTitle = escapeAttr(title);
    const iconData = popupIcons.getIconSources ? popupIcons.getIconSources(tab, 16) : { sources: [], hostname: '' };
    const fallbackLabel = popupIcons.getFallbackLabel ? popupIcons.getFallbackLabel(title, iconData.hostname) : '?';
    const closeLabel = popupI18n.t ? popupI18n.t('closeTabButton') : 'Close';
    return `
      <div class="popup-tab-row" style="--g:${groupIndex};--r:${tabIndex}" data-action="open-popup-url" data-url="${safeUrl}" data-tab-id="${tab.id}">
        ${iconData.sources?.[0] ? `<img class="popup-tab-favicon" src="${escapeAttr(iconData.sources[0])}" alt="">` : `<span class="popup-tab-favicon-fallback">${escapeAttr(fallbackLabel)}</span>`}
        <span class="popup-tab-title" title="${safeTitle}">${safeTitle}</span>
        <button class="popup-tab-close-btn" type="button" data-action="close-popup-tab" data-tab-id="${tab.id}" aria-label="${escapeAttr(closeLabel)}" title="${escapeAttr(closeLabel)}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    `;
  }).join('');

  return `
    <section class="popup-tab-group" data-group-id="${escapeAttr(group.domain)}" style="--s:${groupIndex}">
      <h1 class="popup-tab-group-title">${escapeAttr(label)}</h1>
      <div class="popup-tab-group-list">${rows}</div>
    </section>
  `;
}

function renderPopupTabs() {
  const listEl = document.getElementById('popupTabsList');
  const navEl = document.getElementById('popupGroupNav');
  const emptyEl = document.getElementById('popupTabsEmpty');
  if (!listEl || !navEl || !emptyEl) return;

  const tabs = popupState.openTabs;

  if (tabs.length === 0) {
    navEl.innerHTML = '';
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  const groups = buildPopupTabGroups();
  navEl.innerHTML = groups.map((g, i) => renderGroupNav(g, i)).join('');
  navEl.classList.add('is-entering');
  listEl.innerHTML = groups.map((g, i) => renderTabGroup(g, i)).join('');
  listEl.classList.add('is-entering');
  emptyEl.hidden = true;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    navEl.classList.add('is-ready');
    listEl.classList.add('is-ready');
  }));
}

function syncPopupView() {
  const shortcutsTab = document.getElementById('popupShortcutsTab');
  const tabsTab = document.getElementById('popupTabsTab');
  const shortcutsPanel = document.getElementById('popupShortcutsPanel');
  const tabsPanel = document.getElementById('popupTabsPanel');
  const shortcutsList = document.getElementById('popupShortcutsList');
  const tabsList = document.getElementById('popupTabsList');
  const navEl = document.getElementById('popupGroupNav');
  const isTabs = popupState.view === 'tabs';

  shortcutsTab?.classList.toggle('is-active', !isTabs);
  shortcutsTab?.setAttribute('aria-selected', String(!isTabs));
  tabsTab?.classList.toggle('is-active', isTabs);
  tabsTab?.setAttribute('aria-selected', String(isTabs));

  // Strip animation classes so they replay on re-enter
  [shortcutsList, tabsList, navEl].forEach(el => {
    el?.classList.remove('is-ready', 'is-entering');
  });

  if (shortcutsPanel) {
    shortcutsPanel.hidden = isTabs;
    shortcutsPanel.classList.toggle('is-active', !isTabs);
  }
  if (tabsPanel) {
    tabsPanel.hidden = !isTabs;
    tabsPanel.classList.toggle('is-active', isTabs);
  }

  // Re-trigger animation for the incoming active panel
  if (!isTabs && shortcutsList) {
    requestAnimationFrame(() => requestAnimationFrame(() => shortcutsList.classList.add('is-ready')));
  } else if (isTabs && tabsList && navEl) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      tabsList.classList.add('is-ready');
      navEl.classList.add('is-ready');
    }));
  }
}

async function openPopupUrl(url) {
  if (!url) return;
  const existing = await findTabByUrl(url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

async function findTabByUrl(url) {
  try {
    // Normalize trailing slashes for matching
    const normalized = url.replace(/\/+$/, '') || url;
    const tabs = await chrome.tabs.query({ url: normalized });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

async function openPopupTab(tabId, fallbackUrl = '') {
  if (!tabId) {
    await openPopupUrl(fallbackUrl);
    return;
  }

  let targetTab = null;
  try {
    targetTab = await chrome.tabs.get(tabId);
  } catch {
    targetTab = null;
  }

  if (!targetTab?.id) {
    await openPopupUrl(fallbackUrl);
    return;
  }

  let currentWindow = null;
  try {
    currentWindow = await chrome.windows.getCurrent();
  } catch {
    currentWindow = null;
  }

  if (currentWindow?.id && targetTab.windowId && targetTab.windowId !== currentWindow.id) {
    await chrome.windows.update(targetTab.windowId, { focused: true });
    await chrome.tabs.update(targetTab.id, { active: true });
    window.close();
    return;
  }

  await chrome.tabs.update(targetTab.id, { active: true });
  window.close();
}

function handlePopupImageError(event) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  const isGroupIcon = target.classList.contains('group-nav-icon');
  const isShortcutIcon = target.classList.contains('quick-shortcut-icon');
  if (!isGroupIcon && !isShortcutIcon) return;

  const fallbackSrc = String(target.dataset.fallbackSrc || '').trim();
  if (fallbackSrc && target.dataset.fallbackApplied !== 'true') {
    target.dataset.fallbackApplied = 'true';
    target.src = fallbackSrc;
    return;
  }

  target.style.display = 'none';
  if (isShortcutIcon) {
    const card = target.closest('.quick-shortcut-card');
    if (card) {
      card.dataset.iconSource = 'fallback';
      card.dataset.iconTreatment = 'glyph';
      card.dataset.iconPlate = 'circle';
      card.dataset.iconFit = 'contain';
      card.classList.remove(
        'has-icon-treatment-original',
        'has-icon-treatment-glyph',
        'has-icon-treatment-fill',
        'has-icon-treatment-tile',
        'has-icon-treatment-disc',
        'has-icon-plate-circle',
        'has-icon-plate-rounded-square',
        'has-icon-plate-none',
        'has-icon-fit-contain',
        'has-icon-fit-cover'
      );
      card.classList.add(
        'has-icon-treatment-glyph',
        'has-icon-plate-circle',
        'has-icon-fit-contain'
      );
    }
  }
  const sibling = target.nextElementSibling;
  const fallbackClass = isGroupIcon ? 'group-nav-fallback' : 'quick-shortcut-fallback';
  if (sibling?.classList.contains(fallbackClass)) {
    sibling.style.display = '';
  }
}

async function refreshPopup(scopes = POPUP_FULL_REFRESH_SCOPES) {
  const requestedScopes = normalizePopupRefreshScopes(scopes);
  const shouldLoadShortcuts = requestedScopes.has(POPUP_REFRESH_SCOPE.SHORTCUTS);
  const shouldLoadTabs = popupState.view === 'tabs' && requestedScopes.has(POPUP_REFRESH_SCOPE.TABS);
  const shouldRenderShortcuts = shouldLoadShortcuts
    || requestedScopes.has(POPUP_REFRESH_SCOPE.THEME)
    || requestedScopes.has(POPUP_REFRESH_SCOPE.FAVICON);
  const shouldRenderTabs = popupState.view === 'tabs' && (
    shouldLoadTabs
    || requestedScopes.has(POPUP_REFRESH_SCOPE.FAVICON)
    || requestedScopes.has(POPUP_REFRESH_SCOPE.LANGUAGE)
  );
  const faviconCache = globalThis.TabHarborFaviconCache;
  await Promise.all([
    requestedScopes.has(POPUP_REFRESH_SCOPE.FAVICON) && faviconCache?.initFaviconCache
      ? faviconCache.initFaviconCache()
      : undefined,
    requestedScopes.has(POPUP_REFRESH_SCOPE.THEME) && popupTheme.loadThemePreferences
      ? popupTheme.loadThemePreferences()
      : undefined,
    loadPopupState({
      skipTabs: !shouldLoadTabs,
      skipShortcuts: !shouldLoadShortcuts,
    }),
  ]);

  if (shouldRenderShortcuts) renderPopupShortcuts();
  if (shouldRenderTabs) renderPopupTabs();
  syncPopupView();
  if ((shouldRenderShortcuts || shouldRenderTabs || requestedScopes.has(POPUP_REFRESH_SCOPE.LANGUAGE)) && popupI18n.applyDomTranslations) {
    popupI18n.applyDomTranslations(document.querySelector('.popup-app'));
  }
  if (requestedScopes.has(POPUP_REFRESH_SCOPE.THEME) && popupTheme.syncPopupTheme) {
    popupTheme.syncPopupTheme(document);
  }
}

function schedulePopupRefresh(scopes = POPUP_FULL_REFRESH_SCOPES, delay = 120) {
  addPopupRefreshScopes(popupPendingRefreshScopes, scopes);
  if (popupRefreshTimer) {
    clearTimeout(popupRefreshTimer);
  }
  popupRefreshTimer = setTimeout(() => {
    popupRefreshTimer = null;
    const scheduledScopes = new Set(popupPendingRefreshScopes);
    popupPendingRefreshScopes.clear();
    void refreshPopupSafely(scheduledScopes);
  }, delay);
}

async function refreshPopupSafely(scopes = POPUP_FULL_REFRESH_SCOPES) {
  const requestedScopes = normalizePopupRefreshScopes(scopes);
  if (popupRefreshInFlight) {
    addPopupRefreshScopes(popupQueuedRefreshScopes, requestedScopes);
    return popupRefreshInFlight;
  }

  popupRefreshInFlight = (async () => {
    try {
      await refreshPopup(requestedScopes);
    } finally {
      popupRefreshInFlight = null;
      if (popupQueuedRefreshScopes.size) {
        const queuedScopes = new Set(popupQueuedRefreshScopes);
        popupQueuedRefreshScopes.clear();
        schedulePopupRefresh(queuedScopes, 0);
      }
    }
  })();

  return popupRefreshInFlight;
}

function handlePopupStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;
  const scopes = new Set();
  for (const key of Object.keys(changes || {})) {
    if (!POPUP_REFRESH_KEYS.has(key)
      && !key.startsWith('tabHarbor.shortcut.')
      && !key.startsWith('tabHarbor.favicon.entry.')) continue;

    if (key === 'quickShortcuts' || key.startsWith('tabHarbor.shortcut.')) {
      scopes.add(POPUP_REFRESH_SCOPE.SHORTCUTS);
    } else if (key === 'sessionGroups' || key === 'groupOrder' || key === 'groupTabOrder') {
      scopes.add(POPUP_REFRESH_SCOPE.TABS);
    } else if (key === 'themePreferences') {
      scopes.add(POPUP_REFRESH_SCOPE.THEME);
    } else if (key === 'languagePreference') {
      scopes.add(POPUP_REFRESH_SCOPE.LANGUAGE);
    } else if (key.startsWith('tabHarbor.favicon.')) {
      scopes.add(POPUP_REFRESH_SCOPE.FAVICON);
    }
  }
  if (scopes.size) schedulePopupRefresh(scopes);
}

function registerPopupAutoRefresh() {
  const scheduleTabs = () => schedulePopupRefresh([POPUP_REFRESH_SCOPE.TABS]);
  const handleTabUpdated = (_tabId, changeInfo) => {
    const relevantFields = ['url', 'title', 'favIconUrl', 'groupId'];
    if (relevantFields.some(field => Object.prototype.hasOwnProperty.call(changeInfo || {}, field))) {
      scheduleTabs();
    }
  };

  chrome.tabs?.onActivated?.addListener(scheduleTabs);
  chrome.tabs?.onAttached?.addListener(scheduleTabs);
  chrome.tabs?.onCreated?.addListener(scheduleTabs);
  chrome.tabs?.onDetached?.addListener(scheduleTabs);
  chrome.tabs?.onMoved?.addListener(scheduleTabs);
  chrome.tabs?.onRemoved?.addListener(scheduleTabs);
  chrome.tabs?.onUpdated?.addListener(handleTabUpdated);
  chrome.tabGroups?.onCreated?.addListener(scheduleTabs);
  chrome.tabGroups?.onRemoved?.addListener(scheduleTabs);
  chrome.tabGroups?.onUpdated?.addListener(scheduleTabs);
  chrome.storage?.onChanged?.addListener(handlePopupStorageChanged);
  chrome.runtime?.onMessage?.addListener(message => {
    if (message?.action === 'tabs-changed') {
      scheduleTabs();
    }
  });
}

function initializePopup() {
  document.addEventListener('error', handlePopupImageError, true);
  registerPopupAutoRefresh();

  document.addEventListener('click', async e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'switch-popup-view') {
      const newView = actionEl.dataset.view === 'tabs' ? 'tabs' : 'shortcuts';
      if (newView === 'tabs' && popupState.view !== 'tabs') {
        popupState.view = 'tabs';
        await refreshPopupSafely([POPUP_REFRESH_SCOPE.TABS]);
      } else {
        popupState.view = newView;
        syncPopupView();
      }
      return;
    }

    if (action === 'refresh-popup') {
      await refreshPopupSafely(POPUP_FULL_REFRESH_SCOPES);
      return;
    }

    if (action === 'close-popup-tab') {
      e.preventDefault();
      const tabId = Number(actionEl.dataset.tabId);
      if (!tabId) return;
      actionEl.classList.add('is-loading');
      try {
        await chrome.tabs.remove(tabId);
        schedulePopupRefresh([POPUP_REFRESH_SCOPE.TABS], 0);
      } finally {
        actionEl.classList.remove('is-loading');
      }
      return;
    }

    if (action === 'open-popup-url') {
      e.preventDefault();
      const tabId = Number(actionEl.dataset.tabId);
      if (tabId) {
        await openPopupTab(tabId, actionEl.dataset.url || '');
      } else {
        await openPopupUrl(actionEl.dataset.url || '');
      }
      return;
    }

    if (action === 'jump-popup-group') {
      const groupId = actionEl.dataset.groupId || '';
      const target = document.querySelector(`.popup-tab-group[data-group-id="${CSS.escape(groupId)}"]`);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  refreshPopupSafely(POPUP_INITIAL_REFRESH_SCOPES)
    .then(() => requestAnimationFrame(() => document.body.classList.add('is-ready')))
    .catch(() => {
      renderPopupShortcuts();
      renderPopupTabs();
      syncPopupView();
      if (popupI18n.applyDomTranslations) {
        popupI18n.applyDomTranslations(document.querySelector('.popup-app'));
      }
      document.body.classList.add('is-ready');
    });
}

initializePopup();
