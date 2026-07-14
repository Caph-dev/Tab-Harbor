'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

delete globalThis.TabHarborQuickShortcutsController;
require('./quick-shortcuts-controller.js');
const controllerApi = globalThis.TabHarborQuickShortcutsController;

test('moves shortcut ids without mutating the source order', () => {
  const source = ['one', 'two', 'three'];

  assert.deepEqual(controllerApi.moveIdToIndex(source, 'one', 2), ['two', 'three', 'one']);
  assert.deepEqual(controllerApi.moveIdToIndex(source, 'three', 0), ['three', 'one', 'two']);
  assert.deepEqual(source, ['one', 'two', 'three']);
});

test('finds the nearest stable drag slot', () => {
  const slots = [
    { centerX: 20, centerY: 20 },
    { centerX: 100, centerY: 20 },
    { centerX: 20, centerY: 100 },
  ];

  assert.equal(controllerApi.findTargetSlotIndex(slots, 88, 24), 1);
  assert.equal(controllerApi.findTargetSlotIndex(slots, 24, 88), 2);
  assert.equal(controllerApi.findTargetSlotIndex([], 0, 0), -1);
});

test('owns delegated shortcut events and full-card drag preview', () => {
  const source = fs.readFileSync(path.join(__dirname, 'quick-shortcuts-controller.js'), 'utf8');
  const themeSource = fs.readFileSync(path.join(__dirname, 'theme-controls.js'), 'utf8');

  assert.match(source, /const DEFAULT_DRAG_THRESHOLD = 8;/);
  assert.match(source, /root\.addEventListener\('auxclick', onAuxClick, true\)/);
  assert.match(source, /root\.addEventListener\('contextmenu', onContextMenu\)/);
  assert.match(source, /const preview = drag\.sourceCard\.cloneNode\(true\);/);
  assert.doesNotMatch(source, /draggable\s*=|dragstart|setDragImage/);
  assert.doesNotMatch(themeSource, /quickShortcut(?:DragState|DraggedId|GhostEl|SlotEl|ActionsOpenId)/);
  assert.doesNotMatch(themeSource, /(?:close|open|preview|animate|ensure|clear)QuickShortcut(?:Actions|Order|Node|Slot|Ghost|DragState)/);
  assert.doesNotMatch(themeSource, /addEventListener\('(auxclick|contextmenu|pointermove|pointerup|pointercancel)'/);
});

test('routes shortcut reordering through the theme persistence boundary', () => {
  const themeSource = fs.readFileSync(path.join(__dirname, 'theme-controls.js'), 'utf8');

  assert.match(themeSource, /onReorder:\s*\(\{ ids \}\) => saveQuickShortcutOrder\(ids\)/);
  assert.doesNotMatch(themeSource, /onReorder:\s*\(\{ ids \}\) => reorderQuickShortcuts\(ids\)/);
});
