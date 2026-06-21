'use strict';

(function attachLocalBackup(globalScope) {
  const BACKUP_SCHEMA = 'tab-harbor-local-backup-v1';
  const BACKUP_DIR = '.Tab Harbor Backups';
  const BACKUP_HISTORY_LIMIT = 15;
  const LATEST_BACKUP_FILENAME = `${BACKUP_DIR}/tab-harbor-backup-latest.json`;
  const BACKUP_META_KEY = 'tabHarbor.localBackup.meta';

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function getDateStamp(date = new Date()) {
    return [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
    ].join('-');
  }

  function getDailyBackupFilename(date = new Date()) {
    return `${BACKUP_DIR}/tab-harbor-backup-${getDateStamp(date)}.json`;
  }

  function getBackupDateFromFilename(filename = '') {
    const normalized = String(filename || '').replace(/\\/g, '/');
    const escapedDir = BACKUP_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = normalized.match(new RegExp(`(?:^|/)${escapedDir}/tab-harbor-backup-(\\d{4}-\\d{2}-\\d{2})\\.json$`));
    return match?.[1] || '';
  }

  function getPrunableBackupDownloadIds(downloads = [], limit = BACKUP_HISTORY_LIMIT) {
    const dailyBackups = (Array.isArray(downloads) ? downloads : [])
      .map(item => ({
        id: item?.id,
        date: getBackupDateFromFilename(item?.filename),
      }))
      .filter(item => Number.isInteger(item.id) && item.date);

    const retainedDates = new Set(
      [...new Set(dailyBackups.map(item => item.date))]
        .sort((a, b) => b.localeCompare(a))
        .slice(0, Math.max(0, limit))
    );

    return dailyBackups
      .filter(item => !retainedDates.has(item.date))
      .map(item => item.id);
  }

  function countSyncItems(sync = {}, prefix) {
    return Object.keys(sync || {}).filter(key => key.startsWith(prefix)).length;
  }

  function countArray(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  function createBackupSummary(local = {}, sync = {}) {
    return {
      savedCount: Math.max(
        countArray(local.deferred),
        countSyncItems(sync, 'tabHarbor.saved.item.')
      ),
      todoCount: Math.max(
        countArray(local.todos),
        countSyncItems(sync, 'tabHarbor.todo.item.')
      ),
      shortcutCount: Math.max(
        countArray(local.quickShortcuts),
        countSyncItems(sync, 'tabHarbor.shortcut.item.')
      ),
      localKeyCount: Object.keys(local || {}).length,
      syncKeyCount: Object.keys(sync || {}).length,
    };
  }

  function createBackupPayload({
    local = {},
    sync = {},
    createdAt = new Date().toISOString(),
    extensionId = '',
    manifest = {},
    reason = 'automatic',
  } = {}) {
    return {
      schema: BACKUP_SCHEMA,
      createdAt,
      reason,
      extension: {
        id: extensionId,
        name: manifest.name || 'Tab Harbor',
        version: manifest.version || '',
      },
      summary: createBackupSummary(local, sync),
      storage: {
        local,
        sync,
      },
    };
  }

  function createBackupDataUrl(payload) {
    const json = JSON.stringify(payload, null, 2);
    return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  }

  function isRelevantStorageChange(changes = {}, areaName = '') {
    if (areaName !== 'local' && areaName !== 'sync') return false;
    const keys = Object.keys(changes || {});
    if (!keys.length) return false;
    return keys.some(key => key !== BACKUP_META_KEY);
  }

  const api = {
    BACKUP_HISTORY_LIMIT,
    BACKUP_META_KEY,
    BACKUP_SCHEMA,
    LATEST_BACKUP_FILENAME,
    createBackupDataUrl,
    createBackupPayload,
    createBackupSummary,
    getBackupDateFromFilename,
    getDailyBackupFilename,
    getPrunableBackupDownloadIds,
    isRelevantStorageChange,
  };

  globalScope.TabHarborLocalBackup = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
