'use strict';

(function attachOptionalLocalConfig(globalScope) {
  if (globalScope.TabHarborConfigReady && typeof globalScope.TabHarborConfigReady.then === 'function') {
    return;
  }

  globalScope.TabHarborConfigReady = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('config.local.js')
      : 'config.local.js';
    script.dataset.tabHarborOptionalConfig = 'true';
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
