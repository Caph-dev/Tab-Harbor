'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStyleDeclaration() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(name, String(value));
    },
    removeProperty(name) {
      values.delete(name);
    },
    getPropertyValue(name) {
      return values.get(name) || '';
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach(name => values.add(name));
    },
    remove(...names) {
      names.forEach(name => values.delete(name));
    },
    toggle(name, force) {
      const nextValue = force === undefined ? !values.has(name) : Boolean(force);
      if (nextValue) values.add(name);
      else values.delete(name);
      return nextValue;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function createElement() {
  const attributes = new Map();
  return {
    attributes,
    classList: createClassList(),
    dataset: {},
    hidden: false,
    innerHTML: '',
    open: false,
    style: createStyleDeclaration(),
    textContent: '',
    value: '',
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    focus() {},
    querySelector() {
      return null;
    },
  };
}

function createThemeRuntime() {
  const ids = [
    'themeMenuTrigger',
    'themeModeOptions',
    'headerPinToggle',
    'themeMenuPanel',
    'themeOptions',
    'themeTransparencyRange',
    'themeTransparencyValue',
    'drawerSpeedRange',
    'drawerSpeedValue',
    'themePersonalize',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const firstFocusable = createElement();
  let focusedElement = null;
  firstFocusable.focus = () => {
    focusedElement = firstFocusable;
  };
  elements.themeMenuPanel.querySelector = () => firstFocusable;
  elements.themeMenuTrigger.focus = () => {
    focusedElement = elements.themeMenuTrigger;
  };

  const root = createElement();
  const body = createElement();
  const savedValues = [];
  const translations = {
    themeModeSystem: '系统',
    themeModeLight: '浅色',
    themeModeDark: '深色',
    themeStylePaperDeskName: '纸上书桌',
    themeStylePaperDeskMeta: '暖纸、文学、沉静',
    themeStyleIvoryIndexName: '象牙索引',
    themeStyleIvoryIndexMeta: '精确、紧凑、内容优先',
    themeStyleHarborMistName: '港湾薄雾',
    themeStyleHarborMistMeta: '轻盈、低压力、冷静',
    themeStyleClayNotesName: '陶土手记',
    themeStyleClayNotesMeta: '温暖、个人化、有触感',
    themeStyleBotanicalFolioName: '植物图谱',
    themeStyleBotanicalFolioMeta: '标本纸、鼠尾草墨色与安静分类',
    themeStylePorcelainAtlasName: '瓷器地图',
    themeStylePorcelainAtlasMeta: '釉白、钴蓝线条与地图秩序',
    themeStyleNocturneObservatoryName: '天文夜曲',
    themeStyleNocturneObservatoryMeta: '深靛夜色、黄铜刻度与克制层次',
    themeStyleVermilionSealName: '朱砂印记',
    themeStyleVermilionSealMeta: '宣纸、墨色与克制朱砂',
  };

  const context = vm.createContext({
    URL,
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          async get() {
            return {
              themePreferences: {
                mode: 'light',
                styleId: 'paper-desk',
                paletteId: 'paper',
                surfaceOpacity: 14,
                drawerSpeed: 4,
              },
            };
          },
          async set(value) {
            savedValues.push(value);
          },
        },
        onChanged: { addListener() {} },
      },
    },
    document: {
      activeElement: null,
      body,
      documentElement: root,
      addEventListener() {},
      removeEventListener() {},
      createElement,
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout,
    clearTimeout,
    window: {
      matchMedia(query) {
        return {
          media: query,
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        };
      },
    },
    TabHarborI18n: {
      t(key) {
        return translations[key] || key;
      },
    },
    TabOutBackgroundImage: {},
    TabOutIconUtils: {
      escapeHtml(value) {
        return String(value);
      },
    },
    TabOutListOrder: {},
  });

  const catalogSource = fs.readFileSync(path.join(__dirname, 'theme-catalog.js'), 'utf8');
  const controlsSource = fs.readFileSync(path.join(__dirname, 'theme-controls.js'), 'utf8');
  vm.runInContext(catalogSource, context, { filename: 'theme-catalog.js' });
  vm.runInContext(controlsSource, context, { filename: 'theme-controls.js' });

  return {
    body,
    context,
    elements,
    getFocusedElement: () => focusedElement,
    root,
    savedValues,
  };
}

test('theme runtime opens, localizes, rerenders, and restores focus', async () => {
  const runtime = createThemeRuntime();
  await runtime.context.TabOutThemeControls.loadThemePreferences();

  runtime.context.setThemeMenuOpen(true);
  assert.equal(runtime.elements.themeMenuPanel.hidden, false);
  assert.equal(runtime.elements.themeMenuTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(runtime.getFocusedElement(), runtime.elements.themeMenuPanel.querySelector());
  assert.match(runtime.elements.themeOptions.innerHTML, /纸上书桌/);
  assert.match(runtime.elements.themeOptions.innerHTML, /植物图谱/);
  assert.match(runtime.elements.themeOptions.innerHTML, /朱砂印记/);

  runtime.elements.themePersonalize.open = true;
  await runtime.context.saveThemePreferences({
    styleId: 'porcelain-atlas',
    surfaceOpacity: 22,
  });

  assert.equal(runtime.elements.themePersonalize.open, true);
  assert.equal(runtime.elements.themeTransparencyRange.value, '22');
  assert.equal(runtime.body.dataset.themeStyle, 'porcelain-atlas');
  assert.equal(runtime.root.style.getPropertyValue('--th-card-radius'), 'var(--th-radius-sm)');
  assert.equal(runtime.savedValues.at(-1).themePreferences.styleId, 'porcelain-atlas');

  await runtime.context.saveThemePreferences({ surfaceOpacity: 0 });
  assert.equal(runtime.elements.themeTransparencyRange.value, '0');
  assert.equal(runtime.elements.themeTransparencyValue.textContent, '0%');
  assert.equal(runtime.root.style.getPropertyValue('--custom-surface-opacity'), '0%');
  assert.equal(runtime.savedValues.at(-1).themePreferences.surfaceOpacity, 0);

  await runtime.context.saveThemePreferences({ surfaceOpacity: 100 });
  assert.equal(runtime.elements.themeTransparencyRange.value, '100');
  assert.equal(runtime.elements.themeTransparencyValue.textContent, '100%');
  assert.equal(runtime.root.style.getPropertyValue('--custom-surface-opacity'), '100%');
  assert.equal(runtime.savedValues.at(-1).themePreferences.surfaceOpacity, 100);

  runtime.context.setThemeMenuOpen(false, { restoreFocus: true });
  assert.equal(runtime.elements.themeMenuPanel.hidden, true);
  assert.equal(runtime.getFocusedElement(), runtime.elements.themeMenuTrigger);
});
