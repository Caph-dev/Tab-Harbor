'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const localBackupApi = require('./local-backup.js');

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map(listener => listener(...args));
    },
  };
}

function createTimers(clock) {
  let nextId = 1;
  const scheduled = new Map();

  return {
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    get size() {
      return scheduled.size;
    },
    async runNext() {
      const entry = scheduled.entries().next().value;
      assert.ok(entry, 'expected a scheduled callback');
      const [id, task] = entry;
      scheduled.delete(id);
      clock.now += task.delay;
      return task.callback();
    },
  };
}

function createBackgroundHarness({ queryTabs } = {}) {
  const clock = { now: 1_000 };
  const timers = createTimers(clock);
  const calls = {
    alarms: [],
    faviconInit: 0,
    queries: 0,
    sentMessages: [],
  };
  const events = {
    alarm: createEvent(),
    installed: createEvent(),
    message: createEvent(),
    startup: createEvent(),
    storageChanged: createEvent(),
    tabCreated: createEvent(),
    tabRemoved: createEvent(),
    tabUpdated: createEvent(),
  };

  class FakeDate extends Date {
    static now() {
      return clock.now;
    }
  }

  const faviconApi = {
    initFaviconCache() {
      calls.faviconInit++;
      return Promise.resolve();
    },
    normalizeFaviconHostname() {
      return '';
    },
    isCacheableFaviconHostname() {
      return false;
    },
  };

  const chrome = {
    action: {
      setBadgeText() {
        return Promise.resolve();
      },
    },
    alarms: {
      create(name, options) {
        calls.alarms.push({ name, options });
      },
      onAlarm: events.alarm,
    },
    runtime: {
      id: 'test-extension',
      getManifest() {
        return { name: 'Tab Harbor', version: '0.0.0' };
      },
      onInstalled: events.installed,
      onMessage: events.message,
      onStartup: events.startup,
    },
    storage: {
      local: {
        get(keys) {
          if (keys === localBackupApi.BACKUP_META_KEY) {
            return Promise.resolve({
              [localBackupApi.BACKUP_META_KEY]: {
                lastBackupAt: new Date(clock.now).toISOString(),
              },
            });
          }
          return Promise.resolve({});
        },
        set() {
          return Promise.resolve();
        },
      },
      sync: {
        get() {
          return Promise.resolve({});
        },
      },
      onChanged: events.storageChanged,
    },
    tabs: {
      query(queryInfo) {
        calls.queries++;
        return queryTabs ? queryTabs(queryInfo, calls.queries) : Promise.resolve([]);
      },
      sendMessage(tabId, message) {
        calls.sentMessages.push({ tabId, message });
        return Promise.resolve();
      },
      onCreated: events.tabCreated,
      onRemoved: events.tabRemoved,
      onUpdated: events.tabUpdated,
    },
  };

  const context = vm.createContext({
    chrome,
    console,
    Date: FakeDate,
    Promise,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    importScripts() {},
    TabHarborFaviconCache: faviconApi,
    TabHarborLocalBackup: localBackupApi,
  });

  new vm.Script(backgroundSource, { filename: 'background.js' }).runInContext(context);

  return { calls, events, timers };
}

test('background registers each persistent event listener once', () => {
  const { events } = createBackgroundHarness();

  for (const event of Object.values(events)) {
    assert.equal(event.listeners.length, 1);
  }
});

test('background cold load does not scan tabs to seed favicons', async () => {
  const { calls } = createBackgroundHarness();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.queries, 0);
  assert.equal(calls.faviconInit, 0);
});

test('tab event bursts coalesce into one dashboard query', async () => {
  const { calls, events, timers } = createBackgroundHarness();

  events.tabCreated.emit({ id: 1 });
  events.tabRemoved.emit(2);
  events.tabUpdated.emit(3, { status: 'complete' }, { id: 3 });

  assert.equal(timers.size, 1);
  await timers.runNext();
  assert.equal(calls.queries, 1);
});

test('tab events during an active refresh schedule one follow-up query', async () => {
  let resolveFirstQuery;
  const firstQuery = new Promise(resolve => {
    resolveFirstQuery = resolve;
  });
  const { calls, events, timers } = createBackgroundHarness({
    queryTabs(_queryInfo, queryNumber) {
      return queryNumber === 1 ? firstQuery : Promise.resolve([]);
    },
  });

  events.tabCreated.emit({ id: 1 });
  const activeRefresh = timers.runNext();
  await Promise.resolve();
  assert.equal(calls.queries, 1);

  events.tabRemoved.emit(2);
  events.tabUpdated.emit(3, { url: 'https://example.com/' }, { id: 3 });
  assert.equal(timers.size, 0);

  resolveFirstQuery([]);
  await activeRefresh;
  assert.equal(timers.size, 1);

  await timers.runNext();
  assert.equal(calls.queries, 2);
});

test('backup scheduling ignores favicon cache changes but accepts user data', async () => {
  const { calls, events } = createBackgroundHarness();
  await Promise.resolve();
  await Promise.resolve();
  const initialAlarmCount = calls.alarms.length;

  events.storageChanged.emit({ 'tabHarbor.favicon.cache': { newValue: {} } }, 'local');
  assert.equal(calls.alarms.length, initialAlarmCount);

  events.storageChanged.emit({ deferred: { newValue: [] } }, 'local');
  assert.equal(calls.alarms.length, initialAlarmCount + 1);
  assert.equal(calls.alarms.at(-1).name, 'tab-harbor-local-backup-pending');
});
