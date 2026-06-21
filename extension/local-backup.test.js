'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('./local-backup.js');

test('createBackupSummary counts local arrays and itemized sync records', () => {
  const summary = createBackupSummary(
    {
      deferred: [{ id: 'saved-1' }],
      todos: [],
      quickShortcuts: [{ id: 'shortcut-1' }, { id: 'shortcut-2' }],
      themePreferences: { paletteId: 'paper' },
    },
    {
      'tabHarbor.saved.item.saved-1': {},
      'tabHarbor.saved.item.saved-2': {},
      'tabHarbor.todo.item.todo-1': {},
      'tabHarbor.shortcut.item.shortcut-1': {},
    }
  );

  assert.equal(summary.savedCount, 2);
  assert.equal(summary.todoCount, 1);
  assert.equal(summary.shortcutCount, 2);
  assert.equal(summary.localKeyCount, 4);
  assert.equal(summary.syncKeyCount, 4);
});

test('createBackupPayload wraps storage with metadata', () => {
  const payload = createBackupPayload({
    local: { deferred: [] },
    sync: {},
    createdAt: '2026-06-21T00:00:00.000Z',
    extensionId: 'abc',
    manifest: { name: 'Tab Harbor', version: '1.2.3' },
    reason: 'storage-change',
  });

  assert.equal(payload.schema, BACKUP_SCHEMA);
  assert.equal(payload.createdAt, '2026-06-21T00:00:00.000Z');
  assert.equal(payload.reason, 'storage-change');
  assert.deepEqual(payload.extension, { id: 'abc', name: 'Tab Harbor', version: '1.2.3' });
  assert.deepEqual(payload.storage.local, { deferred: [] });
});

test('backup filenames are stable', () => {
  assert.equal(LATEST_BACKUP_FILENAME, '.Tab Harbor Backups/tab-harbor-backup-latest.json');
  assert.equal(
    getDailyBackupFilename(new Date('2026-06-21T12:00:00.000Z')),
    '.Tab Harbor Backups/tab-harbor-backup-2026-06-21.json'
  );
});

test('getBackupDateFromFilename recognizes dated backup files only', () => {
  assert.equal(
    getBackupDateFromFilename('/Users/ty/Downloads/.Tab Harbor Backups/tab-harbor-backup-2026-06-21.json'),
    '2026-06-21'
  );
  assert.equal(
    getBackupDateFromFilename('C:\\Users\\ty\\Downloads\\.Tab Harbor Backups\\tab-harbor-backup-2026-06-20.json'),
    '2026-06-20'
  );
  assert.equal(getBackupDateFromFilename('/Downloads/.Tab Harbor Backups/tab-harbor-backup-latest.json'), '');
  assert.equal(getBackupDateFromFilename('/Downloads/Other/tab-harbor-backup-2026-06-21.json'), '');
});

test('getPrunableBackupDownloadIds keeps the latest dated backups', () => {
  const downloads = Array.from({ length: BACKUP_HISTORY_LIMIT + 3 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      id: index + 1,
      filename: `/Users/ty/Downloads/.Tab Harbor Backups/tab-harbor-backup-2026-06-${day}.json`,
    };
  });
  downloads.push({
    id: 99,
    filename: '/Users/ty/Downloads/.Tab Harbor Backups/tab-harbor-backup-latest.json',
  });

  assert.deepEqual(getPrunableBackupDownloadIds(downloads), [1, 2, 3]);
});

test('getPrunableBackupDownloadIds keeps all files sharing a retained date', () => {
  const downloads = [
    { id: 1, filename: '/Downloads/.Tab Harbor Backups/tab-harbor-backup-2026-06-01.json' },
    { id: 2, filename: '/Downloads/.Tab Harbor Backups/tab-harbor-backup-2026-06-02.json' },
    { id: 3, filename: '/Downloads/.Tab Harbor Backups/tab-harbor-backup-2026-06-02.json' },
  ];

  assert.deepEqual(getPrunableBackupDownloadIds(downloads, 1), [1]);
});

test('createBackupDataUrl encodes readable JSON payload', () => {
  const payload = createBackupPayload({ local: { deferred: [{ id: 'saved-1' }] }, sync: {} });
  const url = createBackupDataUrl(payload);

  assert.match(url, /^data:application\/json;charset=utf-8,/);
  const decoded = JSON.parse(decodeURIComponent(url.split(',', 2)[1]));
  assert.equal(decoded.schema, BACKUP_SCHEMA);
  assert.equal(decoded.storage.local.deferred[0].id, 'saved-1');
});

test('isRelevantStorageChange ignores only backup metadata writes', () => {
  assert.equal(isRelevantStorageChange({}, 'local'), false);
  assert.equal(isRelevantStorageChange({ [BACKUP_META_KEY]: { newValue: {} } }, 'local'), false);
  assert.equal(isRelevantStorageChange({ deferred: { newValue: [] } }, 'local'), true);
  assert.equal(isRelevantStorageChange({ [BACKUP_META_KEY]: {}, deferred: {} }, 'local'), true);
  assert.equal(isRelevantStorageChange({ deferred: {} }, 'managed'), false);
});
