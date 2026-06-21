'use strict';

const {
  mountDashboardRuntime: appMountDashboardRuntime,
} = globalThis.TabHarborDashboardRuntime || {};

const {
  ready: appI18nReady,
} = globalThis.TabHarborI18n || {};

const {
  TabHarborConfigReady: appConfigReady,
} = globalThis;

function syncFooterVersion() {
  const versionEl = document.getElementById('footerVersion');
  const version = globalThis.chrome?.runtime?.getManifest?.().version;
  if (!versionEl || !version) return;
  versionEl.textContent = `v${version}`;
}

async function initializeApp() {
  if (!appMountDashboardRuntime) {
    throw new Error('Tab Harbor dashboard runtime is unavailable');
  }

  syncFooterVersion();

  if (appConfigReady && typeof appConfigReady.then === 'function') {
    await appConfigReady;
  }

  if (appI18nReady && typeof appI18nReady.then === 'function') {
    await appI18nReady;
  }

  await appMountDashboardRuntime();
}

initializeApp();
