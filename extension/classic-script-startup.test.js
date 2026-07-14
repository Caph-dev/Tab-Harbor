'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function getClassicScriptPaths(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const baseDirectory = path.dirname(htmlPath);
  return [...html.matchAll(/<script\s+src="([^"]+\.js)"[^>]*><\/script>/g)]
    .map(match => path.resolve(baseDirectory, match[1]));
}

function compileClassicScriptSurface(htmlPath) {
  const scriptPaths = getClassicScriptPaths(htmlPath);
  assert.ok(scriptPaths.length > 0, `${htmlPath} should load classic scripts`);

  const combinedSource = scriptPaths
    .map(scriptPath => {
      const relativePath = path.relative(__dirname, scriptPath);
      return `\n/* ${relativePath} */\n${fs.readFileSync(scriptPath, 'utf8')}`;
    })
    .join('\n;\n');

  assert.doesNotThrow(
    () => new vm.Script(combinedSource, { filename: path.basename(htmlPath) }),
    `${path.basename(htmlPath)} classic scripts must share one global lexical scope safely`
  );
}

test('dashboard classic scripts compile in their exact HTML order', () => {
  compileClassicScriptSurface(path.join(__dirname, 'index.html'));
});

test('popup classic scripts compile in their exact HTML order', () => {
  compileClassicScriptSurface(path.join(__dirname, 'popup', 'popup.html'));
});

