# Tab Harbor Agent Guide

This file captures project-level design and implementation constraints for agents working in this repository.

## Project Shape

1. Tab Harbor is a browser extension workspace under `extension/`.
2. There is currently no root `package.json`; do not assume npm scripts exist.
3. Tests are plain Node test files next to extension source files, commonly run with `node --test extension/*.test.js`.
4. The runtime is intentionally dependency-light. Do not introduce a bundler, framework, package manager workflow, or build step unless the task explicitly requires it.
5. The extension is loaded from static files. HTML, CSS, manifest, and ordered scripts are product-critical assets, not generated output.

## Design Direction

1. Tab Harbor is a quiet browser workspace, not a SaaS dashboard, wallpaper page, or gamified productivity product.
2. Preserve the calm / literary / composed identity. Interfaces should feel like a reading desk or paper workspace.
3. Prefer scanability over spectacle. If a change makes the page louder before it makes it clearer, reject it.
4. Keep secondary controls quiet. Theme controls, drawer triggers, archive actions, and helper affordances must not visually outrank tab content.
5. Avoid decorative chrome that does not improve hierarchy, orientation, or atmosphere.

## UI Guardrails

1. Do not rely on hover alone for critical controls or discoverability.
2. Keyboard focus must stay visible and usable.
3. Reduced-motion users must still understand every state change without animation.
4. Compact controls still need comfortable hit targets.
5. Theme changes must update the full environment, not just local controls.

## Interaction Lessons

1. Floating editors triggered from compact controls should anchor near the triggering element when practical; default corner placement is only a fallback.
2. For dense icon reordering, prefer explicit grid tracks over `flex-wrap` when cross-row drag behavior matters.
3. For icon drag-and-drop previews, use `ghost + slot` instead of converting the original node to `position: fixed`; keep the dragged visual under the pointer and the layout slot in the flow.
4. Drag preview hit-testing should be based on stable slot positions captured at drag start, not on the currently reflowing DOM alone.
5. FLIP animations in reorderable icon strips should only run for nodes whose order actually changed; avoid re-animating unaffected siblings.

## Frontend Architecture

1. This project is plain HTML, CSS, and ordered `<script>` tags with no bundler or ESM module system.
2. Script load order is part of the runtime contract. Treat changes to `index.html` script order as high impact.
3. Top-level bindings can collide across files. When destructuring from `globalThis`, use file-scoped prefixed aliases instead of shared short names.
4. Keep `extension/app.js` as a thin orchestrator entry. Do not let it grow back into a catch-all runtime file.
5. Prefer responsibility-based module boundaries such as:
   - `ui-helpers.js`
   - `theme-controls.js`
   - `drawer-manager.js`
   - `dashboard-runtime.js`
6. Prefer small, named helpers over expanding large event handlers or rendering functions.
7. Keep persistence, DOM rendering, browser API calls, and visual state transitions separated when practical.

## File Map

1. `extension/index.html` defines the extension page shell and script loading contract.
2. `extension/style.css` owns the main visual system and must preserve the quiet desk atmosphere.
3. `extension/app.js` starts the app and should remain orchestration-focused.
4. `extension/dashboard-runtime.js`, `extension/drawer-manager.js`, `extension/theme-controls.js`, and `extension/ui-helpers.js` carry most UI runtime responsibilities.
5. `extension/*-store.js`, `extension/*-sync*.js`, and `extension/list-order.js` contain state and ordering behavior; keep their tests close to behavior changes.
6. `extension/popup/` is a separate popup surface; do not assume dashboard CSS or runtime behavior applies there.
7. `docs/agents/` contains agent-operational references for issue tracking, labels, and domain docs.

## Refactor Safety

1. After any script split, actively check for startup-time failures such as `Identifier has already been declared`.
2. A passing `node --test extension/*.test.js` run is necessary but not sufficient for startup refactors.
3. If the page shows static scaffolding but not dynamic tab data, first suspect runtime initialization failure before changing data logic.
4. For startup regressions, inspect real browser console/runtime errors before continuing to refactor.
5. Avoid moving functions between script files unless you have checked all `globalThis` exports/imports and the `index.html` load order.
6. When touching drag, ordering, sync, or persistence behavior, look for an adjacent `*.test.js` file before deciding whether new coverage is needed.

## Working Rules

1. Do not overwrite unrelated user changes. This repository may contain local or untracked agent-skill files.
2. Keep edits narrow and product-facing changes consistent with the calm, composed identity.
3. Prefer direct static-file edits over adding tooling.
4. Do not add dependencies, package manifests, or generated assets unless explicitly requested.
5. When changing browser-extension behavior, consider Chrome extension constraints and real browser runtime behavior, not just Node tests.
6. Treat accessibility regressions as product regressions: focus visibility, hit targets, reduced motion, contrast, and non-hover access matter.

## Validation

1. Run `node --test extension/*.test.js` after code changes that affect UI structure, script loading, or runtime behavior.
2. For script-loading or initialization changes, also verify the extension in a real browser session.
3. For CSS-only changes, inspect the affected state visually when possible and confirm reduced-motion behavior if animations/transitions changed.
4. For persistence or sync changes, run the closest focused tests first, then the full `node --test extension/*.test.js` suite when practical.
5. If a command fails because project tooling is absent, report the missing tool/script plainly instead of inventing a workflow.

## Reference

Detailed rationale and lessons learned live in:
- `docs/design-principles-and-lessons.md`
- `.impeccable.md`

## Agent skills

### Issue tracker

本仓库的 issues 和 PRDs 使用 GitHub Issues 跟踪，仓库为 `Walaxy/tab-harbor`。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用 mattpocock/skills 的默认 triage 标签词汇。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库使用 single-context 领域文档布局。详见 `docs/agents/domain.md`。
