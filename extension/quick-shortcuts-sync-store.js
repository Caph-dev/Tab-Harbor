'use strict';

(function attachQuickShortcutsSyncStore(globalScope) {
  const SCHEMA_VERSION = 1;
  const LOCAL_SHORTCUTS_KEY = 'quickShortcuts';
  const LOCAL_TOMBSTONES_KEY = 'tabHarbor.shortcut.tombstones';
  const META_KEY = 'tabHarbor.shortcut.meta';
  const SHORTCUT_ITEM_PREFIX = 'tabHarbor.shortcut.item.';
  const SHORTCUT_ORDER_KEY = 'tabHarbor.shortcut.order';
  const SHORTCUT_SYNC_PREFIXES = [
    'tabHarbor.shortcut.',
    META_KEY,
  ];
  const LIGHTWEIGHT_ICON_MAX_CHARS = 4096;
  const LIGHTWEIGHT_ICON_URL_MAX_CHARS = 2048;
  const LIGHTWEIGHT_GLYPH_MAX_CHARS = 32;
  const LEGACY_LOCAL_FALLBACK_TIME = '1970-01-01T00:00:00.000Z';
  const VALID_ICON_KINDS = new Set(['site', 'glyph', 'image', 'svg']);

  let shortcutsSyncInitPromise = null;
  let shortcutsSyncInitialized = false;
  let shortcutsSyncListenerAttached = false;
  let shortcutsSyncRefreshTimer = 0;
  let lastSyncError = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function asString(value, fallback = '') {
    const next = String(value || '').trim();
    return next || fallback;
  }

  function getTimestampMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function latestTimestamp(...values) {
    const winner = values
      .map(value => ({ value, ms: getTimestampMs(value) }))
      .sort((a, b) => b.ms - a.ms)[0];
    return winner?.value || '';
  }

  function isTombstone(item) {
    return Boolean(item?.deletedAt || item?.dismissed);
  }

  function normalizeIconKind(value) {
    const kind = String(value || '').trim();
    return VALID_ICON_KINDS.has(kind) ? kind : '';
  }

  function isSvgMarkup(value) {
    return /^\s*<svg[\s>]/i.test(String(value || ''));
  }

  function inferShortcutIcon(input) {
    const raw = String(input || '').trim();
    if (!raw) return { value: '', kind: '' };
    if (isSvgMarkup(raw)) return { value: raw, kind: 'svg' };
    if (/^data:image\//i.test(raw)) return { value: raw, kind: 'image' };
    if (/^[a-z]+:\/\//i.test(raw) || raw.includes('.') || raw.startsWith('/')) {
      return { value: raw, kind: 'image' };
    }
    const glyph = [...raw].slice(0, 2).join('');
    return { value: glyph, kind: glyph ? 'glyph' : '' };
  }

  function withUpdatedAt(item, fallbackTime = nowIso()) {
    return {
      ...item,
      updatedAt: item.updatedAt || latestTimestamp(
        item.deletedAt,
        item.createdAt
      ) || fallbackTime,
    };
  }

  function normalizeShortcutItem(item, fallbackTime = nowIso()) {
    if (!item || !item.id) return null;

    const deletedAt = item.deletedAt || null;
    const dismissed = Boolean(item.dismissed || deletedAt);
    const url = asString(item.url);
    if (!url && !dismissed) return null;

    const icon = inferShortcutIcon(item.icon || item.customIcon || '');
    const explicitIconKind = normalizeIconKind(item.iconKind);

    return withUpdatedAt({
      id: String(item.id),
      url,
      label: asString(item.label),
      icon: icon.value,
      iconKind: icon.kind || explicitIconKind,
      iconMask: item.iconMask === 'rounded' ? 'rounded' : 'none',
      createdAt: item.createdAt || fallbackTime,
      dismissed,
      deletedAt,
      updatedAt: item.updatedAt || null,
      iconOmitted: Boolean(item.iconOmitted),
    }, fallbackTime);
  }

  function normalizeShortcutItems(input, fallbackTime = nowIso()) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const items = [];

    for (const item of input) {
      const normalized = normalizeShortcutItem(item, fallbackTime);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      items.push(normalized);
    }

    return items;
  }

  function normalizeOrder(order) {
    const ids = Array.isArray(order?.ids)
      ? [...new Set(order.ids.map(id => String(id)).filter(Boolean))]
      : [];
    return {
      ids,
      updatedAt: order?.updatedAt || '',
    };
  }

  function itemUpdatedAtMs(item) {
    return getTimestampMs(item?.updatedAt) ||
      getTimestampMs(item?.deletedAt) ||
      getTimestampMs(item?.createdAt);
  }

  function chooseItemWinner(existingItem, candidateItem) {
    if (!existingItem) return candidateItem;
    if (!candidateItem) return existingItem;

    const existingMs = itemUpdatedAtMs(existingItem);
    const candidateMs = itemUpdatedAtMs(candidateItem);
    if (candidateMs > existingMs) return candidateItem;
    if (candidateMs < existingMs) return existingItem;

    if (isTombstone(candidateItem) && !isTombstone(existingItem)) return candidateItem;
    return existingItem;
  }

  function preserveLocalOmittedIcon(item, localItem) {
    if (!item?.iconOmitted || isTombstone(item) || !localItem?.icon) return item;
    return {
      ...item,
      icon: localItem.icon,
      iconKind: localItem.iconKind || item.iconKind,
      iconMask: localItem.iconMask || item.iconMask,
    };
  }

  function mergeItems(syncItems, localItems, { migratedAt = '' } = {}) {
    const merged = new Map();
    const localById = new Map(localItems.map(item => [item.id, item]));
    const migratedAtMs = getTimestampMs(migratedAt);

    for (const item of syncItems) {
      merged.set(item.id, chooseItemWinner(merged.get(item.id), item));
    }
    for (const item of localItems) {
      if (!merged.has(item.id) && migratedAtMs && itemUpdatedAtMs(item) <= migratedAtMs) continue;
      merged.set(item.id, chooseItemWinner(merged.get(item.id), item));
    }

    return [...merged.values()].map(item => preserveLocalOmittedIcon(item, localById.get(item.id)));
  }

  function getActiveItems(items, fallbackTime = nowIso()) {
    return normalizeShortcutItems(items, fallbackTime).filter(item => !isTombstone(item));
  }

  function getTombstoneItems(items, fallbackTime = nowIso()) {
    return normalizeShortcutItems(items, fallbackTime).filter(isTombstone);
  }

  function chooseOrder(syncOrder, localOrder, localItems) {
    const normalizedSyncOrder = normalizeOrder(syncOrder);
    const normalizedLocalOrder = normalizeOrder(localOrder);
    const activeLocalItems = getActiveItems(localItems);
    const fallbackLocalOrder = {
      ids: activeLocalItems.map(item => item.id).filter(Boolean),
      updatedAt: latestTimestamp(...activeLocalItems.map(item => item.updatedAt)),
    };
    const effectiveLocalOrder = normalizedLocalOrder.ids.length ? normalizedLocalOrder : fallbackLocalOrder;

    if (!normalizedSyncOrder.ids.length) return effectiveLocalOrder;
    if (!effectiveLocalOrder.ids.length) return normalizedSyncOrder;
    if (getTimestampMs(effectiveLocalOrder.updatedAt) > getTimestampMs(normalizedSyncOrder.updatedAt)) {
      return effectiveLocalOrder;
    }
    return normalizedSyncOrder;
  }

  function applyOrder(items, order) {
    const normalizedOrder = normalizeOrder(order);
    const itemMap = new Map(items.map(item => [item.id, item]));
    const ordered = [];
    const used = new Set();

    for (const id of normalizedOrder.ids) {
      const item = itemMap.get(id);
      if (!item || used.has(id) || isTombstone(item)) continue;
      ordered.push(item);
      used.add(id);
    }

    const unorderedActive = items
      .filter(item => !used.has(item.id) && !isTombstone(item))
      .sort((a, b) => itemUpdatedAtMs(a) - itemUpdatedAtMs(b));
    const tombstones = items.filter(isTombstone);

    return [...ordered, ...unorderedActive, ...tombstones];
  }

  function buildOrder(items, updatedAt = nowIso()) {
    return {
      ids: [...new Set(getActiveItems(items).map(item => String(item.id || '')).filter(Boolean))],
      updatedAt,
    };
  }

  function reorderSubsetByIds(items, orderIds) {
    const activeItems = getActiveItems(items);
    const tombstones = getTombstoneItems(items);
    const normalizedOrder = Array.isArray(orderIds)
      ? orderIds.map(id => String(id)).filter(Boolean)
      : [];
    if (!activeItems.length || activeItems.length !== normalizedOrder.length) {
      return [...activeItems, ...tombstones];
    }

    const itemMap = new Map(activeItems.map(item => [String(item.id), item]));
    if (itemMap.size !== activeItems.length) return [...activeItems, ...tombstones];
    if (normalizedOrder.some(id => !itemMap.has(id))) return [...activeItems, ...tombstones];

    return [
      ...normalizedOrder.map(id => itemMap.get(id)).filter(Boolean),
      ...tombstones,
    ];
  }

  function getStorageArea(areaName) {
    return globalScope.chrome?.storage?.[areaName] || null;
  }

  async function storageGet(areaName, keys) {
    const area = getStorageArea(areaName);
    if (!area?.get) return {};
    return area.get(keys);
  }

  async function storageSet(areaName, items) {
    const area = getStorageArea(areaName);
    if (!area?.set) return false;
    await area.set(items);
    return true;
  }

  function getSyncKeyForItem(id) {
    return `${SHORTCUT_ITEM_PREFIX}${String(id)}`;
  }

  function extractItemsFromSync(syncData) {
    return Object.entries(syncData || {})
      .filter(([key]) => key.startsWith(SHORTCUT_ITEM_PREFIX))
      .map(([, value]) => normalizeShortcutItem(value))
      .filter(Boolean);
  }

  function normalizeTombstoneMap(input) {
    const values = input && typeof input === 'object' ? Object.values(input) : [];
    return Object.fromEntries(getTombstoneItems(values).map(item => [item.id, item]));
  }

  async function readLocalState() {
    const local = await storageGet('local', [
      LOCAL_SHORTCUTS_KEY,
      LOCAL_TOMBSTONES_KEY,
      SHORTCUT_ORDER_KEY,
    ]);
    const activeShortcuts = getActiveItems(local[LOCAL_SHORTCUTS_KEY], LEGACY_LOCAL_FALLBACK_TIME);
    const tombstones = getTombstoneItems(
      Object.values(local[LOCAL_TOMBSTONES_KEY] || {}),
      LEGACY_LOCAL_FALLBACK_TIME
    );
    const merged = mergeItems([], [...activeShortcuts, ...tombstones]);
    return {
      shortcuts: merged,
      activeShortcuts: getActiveItems(merged),
      order: normalizeOrder(local[SHORTCUT_ORDER_KEY]),
      tombstones: normalizeTombstoneMap(local[LOCAL_TOMBSTONES_KEY]),
    };
  }

  async function readSyncState() {
    const syncData = await storageGet('sync', null);
    return {
      raw: syncData || {},
      meta: syncData?.[META_KEY] || null,
      shortcuts: extractItemsFromSync(syncData),
      order: normalizeOrder(syncData?.[SHORTCUT_ORDER_KEY]),
    };
  }

  async function writeLocalCaches({ shortcuts, order, tombstones }) {
    const patch = {};
    if (Array.isArray(shortcuts)) {
      patch[LOCAL_SHORTCUTS_KEY] = getActiveItems(shortcuts);
    }
    if (order) patch[SHORTCUT_ORDER_KEY] = normalizeOrder(order);
    if (tombstones) patch[LOCAL_TOMBSTONES_KEY] = normalizeTombstoneMap(tombstones);
    if (!Object.keys(patch).length) return;
    await storageSet('local', patch);
  }

  function dispatchShortcutSyncEvent(type, detail = {}) {
    if (typeof globalScope.dispatchEvent !== 'function') return;
    try {
      const event = typeof globalScope.CustomEvent === 'function'
        ? new globalScope.CustomEvent(type, { detail })
        : { type, detail };
      globalScope.dispatchEvent(event);
    } catch {
      // Best-effort UI notification only.
    }
  }

  function rememberSyncError(error, context) {
    lastSyncError = {
      context,
      message: error?.message || String(error || 'Chrome Sync update failed'),
      at: nowIso(),
    };
    console.warn('[tab-harbor] Quick shortcut Sync update failed:', error);
    dispatchShortcutSyncEvent('tabharbor-quick-shortcuts-sync-error', lastSyncError);
  }

  async function writeSyncPatch(patch, context) {
    if (!Object.keys(patch || {}).length) return true;

    try {
      const wrote = await storageSet('sync', patch);
      if (!wrote) throw new Error('chrome.storage.sync is unavailable');
      return true;
    } catch (error) {
      rememberSyncError(error, context);
      return false;
    }
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function getLightweightIconPayload(item) {
    const icon = String(item?.icon || '').trim();
    const inferred = inferShortcutIcon(icon);
    const kind = inferred.kind || normalizeIconKind(item?.iconKind);
    if (!icon) return { icon: '', iconKind: kind || 'site', iconOmitted: false };

    if (kind === 'glyph') {
      return icon.length <= LIGHTWEIGHT_GLYPH_MAX_CHARS
        ? { icon, iconKind: 'glyph', iconOmitted: false }
        : { icon: '', iconKind: 'glyph', iconOmitted: true };
    }

    if (kind === 'svg') {
      return icon.length <= LIGHTWEIGHT_ICON_MAX_CHARS
        ? { icon, iconKind: 'svg', iconOmitted: false }
        : { icon: '', iconKind: 'svg', iconOmitted: true };
    }

    if (kind === 'image') {
      const isDataImage = /^data:image\//i.test(icon);
      const isLightDataImage = isDataImage && icon.length <= LIGHTWEIGHT_ICON_MAX_CHARS;
      const isLightRemoteUrl = !isDataImage && isHttpUrl(icon) && icon.length <= LIGHTWEIGHT_ICON_URL_MAX_CHARS;
      return isLightDataImage || isLightRemoteUrl
        ? { icon, iconKind: 'image', iconOmitted: false }
        : { icon: '', iconKind: 'image', iconOmitted: true };
    }

    return { icon: '', iconKind: kind || 'site', iconOmitted: false };
  }

  function sanitizeShortcutForSync(item) {
    const normalized = normalizeShortcutItem(item);
    if (!normalized) return null;
    const iconPayload = isTombstone(normalized)
      ? { icon: '', iconKind: 'site', iconOmitted: false }
      : getLightweightIconPayload(normalized);
    const payload = {
      id: normalized.id,
      url: normalized.url,
      label: normalized.label,
      icon: iconPayload.icon,
      iconKind: iconPayload.iconKind,
      iconMask: normalized.iconMask,
      createdAt: normalized.createdAt,
      dismissed: Boolean(normalized.dismissed),
      deletedAt: normalized.deletedAt || null,
      updatedAt: normalized.updatedAt,
    };
    if (iconPayload.iconOmitted) payload.iconOmitted = true;
    return payload;
  }

  function buildSyncSnapshotPatch({ shortcuts, order, meta }) {
    const patch = {};
    for (const item of normalizeShortcutItems(shortcuts)) {
      const payload = sanitizeShortcutForSync(item);
      if (payload) patch[getSyncKeyForItem(payload.id)] = payload;
    }
    if (order) patch[SHORTCUT_ORDER_KEY] = normalizeOrder(order);
    if (meta) patch[META_KEY] = meta;
    return patch;
  }

  function hasAnySyncShortcutData(syncState) {
    return Boolean(
      syncState.meta ||
      syncState.shortcuts.length ||
      syncState.order.ids.length
    );
  }

  async function migrateLegacyLocalToSync() {
    const syncState = await readSyncState();
    if (syncState.meta) return;

    const localState = await readLocalState();
    if (!localState.shortcuts.length && !hasAnySyncShortcutData(syncState)) {
      await writeSyncPatch({
        [META_KEY]: {
          schemaVersion: SCHEMA_VERSION,
          migratedAt: nowIso(),
        },
      }, 'migration');
      return;
    }

    const shortcuts = mergeItems(syncState.shortcuts, localState.shortcuts);
    const order = chooseOrder(syncState.order, localState.order, localState.shortcuts);
    const migratedAt = nowIso();
    const ordered = applyOrder(shortcuts, order);

    await writeSyncPatch(buildSyncSnapshotPatch({
      shortcuts: ordered,
      order: {
        ids: getActiveItems(ordered).map(item => item.id),
        updatedAt: order.updatedAt || migratedAt,
      },
      meta: {
        schemaVersion: SCHEMA_VERSION,
        migratedAt,
      },
    }), 'migration');
  }

  async function refreshLocalCacheFromSync({ dispatchUpdate = false } = {}) {
    const [syncState, localState] = await Promise.all([
      readSyncState(),
      readLocalState(),
    ]);

    const shortcutsMerged = mergeItems(syncState.shortcuts, localState.shortcuts, {
      migratedAt: syncState.meta?.migratedAt || '',
    });
    const order = chooseOrder(syncState.order, localState.order, localState.shortcuts);
    const shortcuts = applyOrder(shortcutsMerged, order);

    await writeLocalCaches({
      shortcuts,
      order,
      tombstones: normalizeTombstoneMap(getTombstoneItems(shortcuts)),
    });

    if (dispatchUpdate) {
      dispatchShortcutSyncEvent('tabharbor-quick-shortcuts-sync-updated', {
        shortcutCount: getActiveItems(shortcuts).length,
      });
    }

    return { shortcuts: getActiveItems(shortcuts) };
  }

  function isShortcutSyncChange(changes) {
    return Object.keys(changes || {}).some(key =>
      SHORTCUT_SYNC_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix))
    );
  }

  function attachSyncChangeListener() {
    if (shortcutsSyncListenerAttached) return;
    const storageEvents = globalScope.chrome?.storage?.onChanged;
    if (!storageEvents?.addListener) return;

    storageEvents.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !isShortcutSyncChange(changes)) return;
      if (shortcutsSyncRefreshTimer) clearTimeout(shortcutsSyncRefreshTimer);
      shortcutsSyncRefreshTimer = setTimeout(() => {
        shortcutsSyncRefreshTimer = 0;
        void refreshLocalCacheFromSync({ dispatchUpdate: true });
      }, 80);
    });
    shortcutsSyncListenerAttached = true;
  }

  async function initQuickShortcutsSync() {
    if (shortcutsSyncInitialized) return refreshLocalCacheFromSync();
    if (shortcutsSyncInitPromise) return shortcutsSyncInitPromise;

    shortcutsSyncInitPromise = (async () => {
      try {
        await migrateLegacyLocalToSync();
      } catch (error) {
        rememberSyncError(error, 'migration');
      }

      const result = await refreshLocalCacheFromSync();
      attachSyncChangeListener();
      shortcutsSyncInitialized = true;
      return result;
    })().finally(() => {
      shortcutsSyncInitPromise = null;
    });

    return shortcutsSyncInitPromise;
  }

  async function getQuickShortcuts() {
    const localState = await readLocalState();
    return getActiveItems(applyOrder(localState.shortcuts, localState.order));
  }

  function mergeActiveShortcutInput(inputShortcuts, existingItems, timestamp) {
    const existingById = new Map(existingItems.map(item => [item.id, item]));
    const normalizedInput = getActiveItems(inputShortcuts);
    const nextActive = [];

    for (const item of normalizedInput) {
      const existing = existingById.get(item.id);
      const changed = !existing ||
        existing.url !== item.url ||
        existing.label !== item.label ||
        existing.icon !== item.icon ||
        existing.iconKind !== item.iconKind ||
        existing.iconMask !== item.iconMask;
      nextActive.push(normalizeShortcutItem({
        ...existing,
        ...item,
        createdAt: existing?.createdAt || item.createdAt || timestamp,
        deletedAt: null,
        dismissed: false,
        updatedAt: changed ? timestamp : (existing?.updatedAt || item.updatedAt || timestamp),
        iconOmitted: false,
      }, timestamp));
    }

    return nextActive.filter(Boolean);
  }

  function createDeletedShortcut(item, timestamp) {
    return normalizeShortcutItem({
      ...item,
      icon: '',
      iconKind: 'site',
      dismissed: true,
      deletedAt: timestamp,
      updatedAt: timestamp,
      iconOmitted: false,
    }, timestamp);
  }

  async function saveQuickShortcuts(shortcuts) {
    const localState = await readLocalState();
    const timestamp = nowIso();
    const previousActive = getActiveItems(localState.shortcuts);
    const previousTombstones = getTombstoneItems(localState.shortcuts);
    const nextActive = mergeActiveShortcutInput(shortcuts, localState.shortcuts, timestamp);
    const nextActiveIds = new Set(nextActive.map(item => item.id));
    const deletedFromInput = previousActive
      .filter(item => !nextActiveIds.has(item.id))
      .map(item => createDeletedShortcut(item, timestamp))
      .filter(Boolean);
    const nextItems = [
      ...nextActive,
      ...previousTombstones.filter(item => !nextActiveIds.has(item.id)),
      ...deletedFromInput,
    ];
    const order = buildOrder(nextActive, timestamp);

    await writeLocalCaches({
      shortcuts: nextItems,
      order,
      tombstones: normalizeTombstoneMap(getTombstoneItems(nextItems)),
    });
    await writeSyncPatch(buildSyncSnapshotPatch({
      shortcuts: nextItems,
      order,
    }), 'save-shortcuts');

    return getActiveItems(applyOrder(nextItems, order));
  }

  async function saveQuickShortcut(shortcut = {}) {
    const shortcuts = await getQuickShortcuts();
    const targetId = String(shortcut.id || `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const exists = shortcuts.some(item => item.id === targetId);
    const nextShortcut = { ...shortcut, id: targetId };
    return saveQuickShortcuts(exists
      ? shortcuts.map(item => item.id === targetId ? nextShortcut : item)
      : [...shortcuts, nextShortcut]);
  }

  async function updateQuickShortcut(id, updates = {}) {
    const shortcuts = await getQuickShortcuts();
    const targetId = String(id || '');
    if (!targetId) return shortcuts;
    let didUpdate = false;
    const nextShortcuts = shortcuts.map(item => {
      if (item.id !== targetId) return item;
      didUpdate = true;
      return { ...item, ...updates, id: targetId };
    });
    return didUpdate ? saveQuickShortcuts(nextShortcuts) : shortcuts;
  }

  async function removeQuickShortcutById(id) {
    const localState = await readLocalState();
    const targetId = String(id || '');
    if (!targetId) return getActiveItems(applyOrder(localState.shortcuts, localState.order));

    const timestamp = nowIso();
    const activeItems = getActiveItems(localState.shortcuts);
    const target = localState.shortcuts.find(item => item.id === targetId);
    if (!target) return activeItems;

    const deletedItem = createDeletedShortcut(target, timestamp);
    const nextItems = [
      ...activeItems.filter(item => item.id !== targetId),
      ...getTombstoneItems(localState.shortcuts).filter(item => item.id !== targetId),
      deletedItem,
    ];
    const order = buildOrder(nextItems, timestamp);

    await writeLocalCaches({
      shortcuts: nextItems,
      order,
      tombstones: normalizeTombstoneMap(getTombstoneItems(nextItems)),
    });
    await writeSyncPatch({
      [getSyncKeyForItem(targetId)]: sanitizeShortcutForSync(deletedItem),
      [SHORTCUT_ORDER_KEY]: order,
    }, 'remove-shortcut');

    return getActiveItems(applyOrder(nextItems, order));
  }

  async function reorderQuickShortcuts(orderIds) {
    const localState = await readLocalState();
    const timestamp = nowIso();
    const nextItems = reorderSubsetByIds(localState.shortcuts, orderIds);
    const order = buildOrder(nextItems, timestamp);

    await writeLocalCaches({
      shortcuts: nextItems,
      order,
      tombstones: normalizeTombstoneMap(getTombstoneItems(nextItems)),
    });
    await writeSyncPatch({
      [SHORTCUT_ORDER_KEY]: order,
    }, 'reorder-shortcuts');

    return getActiveItems(applyOrder(nextItems, order));
  }

  function getLastSyncError() {
    return lastSyncError;
  }

  const api = {
    initQuickShortcutsSync,
    getQuickShortcuts,
    saveQuickShortcuts,
    saveQuickShortcut,
    updateQuickShortcut,
    removeQuickShortcutById,
    reorderQuickShortcuts,
    getLastSyncError,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.TabHarborQuickShortcutsSyncStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
