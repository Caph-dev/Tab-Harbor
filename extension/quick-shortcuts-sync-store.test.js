'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function createEventEmitter() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

function createChromeMock({ local = {}, sync = {}, failSyncSet = false } = {}) {
  const onChanged = createEventEmitter();
  const stores = {
    local: { ...local },
    sync: { ...sync },
  };

  function readStore(areaName, keys) {
    const store = stores[areaName];
    if (keys == null) return { ...store };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map(key => [key, store[key]]));
    }
    if (typeof keys === 'string') return { [keys]: store[keys] };
    if (keys && typeof keys === 'object') {
      return Object.fromEntries(Object.keys(keys).map(key => [key, store[key] ?? keys[key]]));
    }
    return {};
  }

  function writeStore(areaName, patch) {
    if (areaName === 'sync' && failSyncSet) {
      throw new Error('QUOTA_BYTES exceeded');
    }

    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      changes[key] = {
        oldValue: stores[areaName][key],
        newValue: value,
      };
      stores[areaName][key] = value;
    }
    onChanged.emit(changes, areaName);
  }

  return {
    stores,
    chrome: {
      storage: {
        local: {
          get: async keys => readStore('local', keys),
          set: async patch => writeStore('local', patch),
        },
        sync: {
          get: async keys => readStore('sync', keys),
          set: async patch => writeStore('sync', patch),
        },
        onChanged,
      },
    },
  };
}

function loadStore(mockOptions) {
  delete require.cache[require.resolve('./quick-shortcuts-sync-store.js')];
  delete globalThis.TabHarborQuickShortcutsSyncStore;
  const mock = createChromeMock(mockOptions);
  globalThis.chrome = mock.chrome;
  globalThis.addEventListener = () => {};
  globalThis.dispatchEvent = () => {};
  globalThis.CustomEvent = function CustomEvent(type, init) {
    return { type, detail: init?.detail };
  };
  const api = require('./quick-shortcuts-sync-store.js');
  return { ...mock, api };
}

test('legacy quick shortcuts migrate into individual sync item keys', async () => {
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        {
          id: 'shortcut-1',
          url: 'https://example.com',
          label: 'Example',
          icon: '★',
          iconKind: 'glyph',
          iconMask: 'rounded',
        },
      ],
    },
  });

  await api.initQuickShortcutsSync();

  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].url, 'https://example.com');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].label, 'Example');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].icon, '★');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].iconKind, 'glyph');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].iconMask, 'rounded');
  assert.deepEqual(stores.sync['tabHarbor.shortcut.order'].ids, ['shortcut-1']);
  assert.equal(stores.sync['tabHarbor.shortcut.meta'].schemaVersion, 1);
});

test('split sync shortcut items merge back into local cache by stored order', async () => {
  const { stores, api } = loadStore({
    sync: {
      'tabHarbor.shortcut.meta': {
        schemaVersion: 1,
        migratedAt: '2026-01-01T00:00:00.000Z',
      },
      'tabHarbor.shortcut.item.a': {
        id: 'a',
        url: 'https://a.example',
        label: 'A',
        icon: '',
        iconKind: 'site',
        iconMask: 'none',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      'tabHarbor.shortcut.item.b': {
        id: 'b',
        url: 'https://b.example',
        label: 'B',
        icon: '<svg viewBox="0 0 1 1"></svg>',
        iconKind: 'svg',
        iconMask: 'rounded',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
      'tabHarbor.shortcut.order': {
        ids: ['b', 'a'],
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    },
  });

  await api.initQuickShortcutsSync();

  assert.deepEqual(stores.local.quickShortcuts.map(item => item.id), ['b', 'a']);
  assert.equal(stores.local.quickShortcuts[0].iconKind, 'svg');
  assert.equal(stores.local.quickShortcuts[0].iconMask, 'rounded');
});

test('remove writes a shortcut tombstone so stale local cache does not revive it', async () => {
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        {
          id: 'shortcut-1',
          url: 'https://old.example',
          label: 'Old',
          icon: '★',
          iconKind: 'glyph',
          iconMask: 'none',
        },
      ],
    },
  });

  await api.initQuickShortcutsSync();
  await api.removeQuickShortcutById('shortcut-1');
  await api.initQuickShortcutsSync();

  assert.equal(stores.local.quickShortcuts.length, 0);
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].dismissed, true);
  assert.ok(stores.sync['tabHarbor.shortcut.item.shortcut-1'].deletedAt);
  assert.equal(stores.local['tabHarbor.shortcut.tombstones']['shortcut-1'].dismissed, true);
});

test('newer sync tombstone wins over legacy local shortcut without updatedAt', async () => {
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        {
          id: 'shortcut-1',
          url: 'https://old.example',
          label: 'Old local copy',
          icon: '★',
          iconKind: 'glyph',
        },
      ],
    },
    sync: {
      'tabHarbor.shortcut.meta': {
        schemaVersion: 1,
        migratedAt: '2026-01-01T00:00:00.000Z',
      },
      'tabHarbor.shortcut.item.shortcut-1': {
        id: 'shortcut-1',
        url: 'https://old.example',
        label: 'Deleted',
        icon: '',
        iconKind: 'site',
        iconMask: 'none',
        createdAt: '2026-01-01T00:00:00.000Z',
        dismissed: true,
        deletedAt: '2026-01-04T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    },
  });

  await api.initQuickShortcutsSync();

  assert.equal(stores.local.quickShortcuts.length, 0);
  assert.equal(stores.local['tabHarbor.shortcut.tombstones']['shortcut-1'].deletedAt, '2026-01-04T00:00:00.000Z');
});

test('shortcut reorder writes sync order and updates local cache', async () => {
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        { id: 'a', url: 'https://a.example', label: 'A', icon: '', iconKind: 'site' },
        { id: 'b', url: 'https://b.example', label: 'B', icon: '', iconKind: 'site' },
      ],
    },
  });

  await api.initQuickShortcutsSync();
  await api.reorderQuickShortcuts(['b', 'a']);

  assert.deepEqual(stores.local.quickShortcuts.map(item => item.id), ['b', 'a']);
  assert.deepEqual(stores.sync['tabHarbor.shortcut.order'].ids, ['b', 'a']);
});

test('newer updatedAt wins shortcut conflict', async () => {
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        {
          id: 'shortcut-1',
          url: 'https://example.com',
          label: 'New local label',
          icon: '★',
          iconKind: 'glyph',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
        },
      ],
    },
    sync: {
      'tabHarbor.shortcut.meta': {
        schemaVersion: 1,
        migratedAt: '2026-01-01T00:00:00.000Z',
      },
      'tabHarbor.shortcut.item.shortcut-1': {
        id: 'shortcut-1',
        url: 'https://example.com',
        label: 'Old sync label',
        icon: '',
        iconKind: 'site',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    },
  });

  await api.initQuickShortcutsSync();

  assert.equal(stores.local.quickShortcuts[0].label, 'New local label');
});

test('large data image is kept in local cache but omitted from sync payload', async () => {
  const bigIcon = `data:image/png;base64,${'a'.repeat(9000)}`;
  const { stores, api } = loadStore({
    local: {
      quickShortcuts: [
        {
          id: 'shortcut-1',
          url: 'https://example.com',
          label: 'Example',
          icon: bigIcon,
          iconKind: 'image',
          iconMask: 'rounded',
        },
      ],
    },
  });

  await api.initQuickShortcutsSync();

  assert.equal(stores.local.quickShortcuts[0].icon, bigIcon);
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].icon, '');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].iconKind, 'image');
  assert.equal(stores.sync['tabHarbor.shortcut.item.shortcut-1'].iconOmitted, true);
});

test('lightweight remote and SVG icons are written to sync', async () => {
  const { stores, api } = loadStore();

  await api.initQuickShortcutsSync();
  await api.saveQuickShortcuts([
    {
      id: 'image-shortcut',
      url: 'https://image.example',
      label: 'Image',
      icon: 'https://image.example/favicon.png',
      iconKind: 'image',
      iconMask: 'rounded',
    },
    {
      id: 'svg-shortcut',
      url: 'https://svg.example',
      label: 'SVG',
      icon: '<svg viewBox="0 0 1 1"></svg>',
      iconKind: 'svg',
      iconMask: 'none',
    },
  ]);

  assert.equal(stores.sync['tabHarbor.shortcut.item.image-shortcut'].icon, 'https://image.example/favicon.png');
  assert.equal(stores.sync['tabHarbor.shortcut.item.image-shortcut'].iconKind, 'image');
  assert.equal(stores.sync['tabHarbor.shortcut.item.svg-shortcut'].icon, '<svg viewBox="0 0 1 1"></svg>');
  assert.equal(stores.sync['tabHarbor.shortcut.item.svg-shortcut'].iconKind, 'svg');
});

test('sync write failure keeps local shortcuts and records an error', async () => {
  const { stores, api } = loadStore({ failSyncSet: true });

  await api.initQuickShortcutsSync();
  await api.saveQuickShortcuts([
    {
      id: 'shortcut-1',
      url: 'https://local.example',
      label: 'Local only',
      icon: '★',
      iconKind: 'glyph',
    },
  ]);

  assert.equal(stores.local.quickShortcuts.length, 1);
  assert.equal(stores.local.quickShortcuts[0].label, 'Local only');
  assert.equal(api.getLastSyncError().context, 'save-shortcuts');
});
