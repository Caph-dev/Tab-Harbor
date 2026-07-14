'use strict';

(function attachQuickShortcutsController(globalScope) {
  if (globalScope.TabHarborQuickShortcutsController) {
    throw new Error('TabHarborQuickShortcutsController already loaded');
  }

  const DEFAULT_DRAG_THRESHOLD = 8;
  const LOCKED_PHASES = new Set([
    'primary-press',
    'action-press',
    'middle-press',
    'context-pending',
    'actions-open',
    'drag-armed',
    'dragging',
    'committing',
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function moveIdToIndex(ids, sourceId, targetIndex) {
    const sourceIndex = ids.indexOf(sourceId);
    if (sourceIndex === -1) return [...ids];

    const next = [...ids];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(clamp(targetIndex, 0, next.length), 0, source);
    return next;
  }

  function findTargetSlotIndex(slotTargets, clientX, clientY) {
    if (!Array.isArray(slotTargets) || slotTargets.length === 0) return -1;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    slotTargets.forEach((slot, index) => {
      const dx = clientX - slot.centerX;
      const dy = clientY - slot.centerY;
      const distance = (dx * dx) + (dy * dy);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }

  function createController(options = {}) {
    const root = options.root;
    if (!root) {
      throw new Error('Quick shortcuts controller requires a root element');
    }

    const ownerDocument = root.ownerDocument || globalScope.document;
    const ownerWindow = ownerDocument?.defaultView || globalScope;
    const dragThreshold = Number.isFinite(options.dragThreshold)
      ? Math.max(0, options.dragThreshold)
      : DEFAULT_DRAG_THRESHOLD;

    const state = {
      mounted: false,
      destroyed: false,
      phase: 'idle',
      openActionsId: '',
      press: null,
      drag: null,
      suppressClickCard: null,
      releaseTimer: 0,
      requestedGeneration: 0,
      pendingSnapshot: null,
      appliedItems: [],
    };

    function getCards() {
      return [...root.children].filter(node => node?.dataset?.shortcutId);
    }

    function getCardById(shortcutId) {
      return getCards().find(card => card.dataset.shortcutId === shortcutId) || null;
    }

    function getPrimaryButton(card) {
      return card?.querySelector?.('.quick-shortcut-open') || null;
    }

    function getActionGroup(card) {
      return card?.querySelector?.('.quick-shortcut-actions') || null;
    }

    function setActionGroupOpen(card, open) {
      if (!card) return;
      const primary = getPrimaryButton(card);
      const actions = getActionGroup(card);

      card.classList.toggle('is-actions-open', open);
      primary?.setAttribute('aria-expanded', String(open));

      if (!actions) return;
      actions.hidden = !open;
      actions.inert = !open;
      actions.setAttribute('aria-hidden', String(!open));
      actions.querySelectorAll('button').forEach(button => {
        button.tabIndex = open ? 0 : -1;
      });
    }

    function syncActionGroups() {
      getCards().forEach(card => {
        setActionGroupOpen(card, card.dataset.shortcutId === state.openActionsId);
      });
    }

    function isRenderLocked() {
      return LOCKED_PHASES.has(state.phase);
    }

    function clearReleaseTimer() {
      if (!state.releaseTimer) return;
      ownerWindow.clearTimeout(state.releaseTimer);
      state.releaseTimer = 0;
    }

    function applyPendingSnapshot() {
      if (isRenderLocked() || !state.pendingSnapshot || state.destroyed) return false;

      const snapshot = state.pendingSnapshot;
      state.pendingSnapshot = null;
      state.appliedItems = snapshot.items;
      root.innerHTML = options.renderItems(snapshot.items, {
        openActionsId: state.openActionsId,
      });
      syncActionGroups();
      return true;
    }

    function flushPendingRender() {
      if (applyPendingSnapshot()) return;
      if (!state.pendingSnapshot && typeof options.onRenderIdle === 'function') {
        options.onRenderIdle();
      }
    }

    function enterIdle({ flush = true } = {}) {
      clearReleaseTimer();
      state.phase = state.openActionsId ? 'actions-open' : 'idle';
      state.press = null;
      if (flush && state.phase === 'idle') {
        flushPendingRender();
      }
    }

    function closeActions({ restoreFocus = false, flush = true } = {}) {
      if (!state.openActionsId) {
        if (flush && state.phase === 'idle') flushPendingRender();
        return;
      }

      const card = getCardById(state.openActionsId);
      const primary = getPrimaryButton(card);
      setActionGroupOpen(card, false);
      state.openActionsId = '';

      if (state.phase === 'actions-open' || state.phase === 'context-pending') {
        state.phase = 'idle';
      }

      if (restoreFocus) {
        primary?.focus?.({ preventScroll: true });
      }

      if (flush && state.phase === 'idle') {
        flushPendingRender();
      }
    }

    function openActions(primary, { focusActions = false } = {}) {
      const card = primary?.closest?.('.quick-shortcut-card[data-shortcut-id]');
      const shortcutId = card?.dataset?.shortcutId || '';
      if (!shortcutId) return;

      closeActions({ flush: false });
      state.openActionsId = shortcutId;
      state.phase = 'actions-open';
      setActionGroupOpen(card, true);

      if (focusActions) {
        getActionGroup(card)?.querySelector('button')?.focus?.({ preventScroll: true });
      }
    }

    function schedulePressRelease(expectedPhase) {
      clearReleaseTimer();
      state.releaseTimer = ownerWindow.setTimeout(() => {
        state.releaseTimer = 0;
        if (state.phase !== expectedPhase) return;
        enterIdle();
      }, 0);
    }

    function captureSlotTargets() {
      return getCards().map((card, index) => {
        const rect = card.getBoundingClientRect();
        return {
          index,
          id: card.dataset.shortcutId || '',
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
    }

    function getOrderIds() {
      return getCards().map(card => card.dataset.shortcutId).filter(Boolean);
    }

    function reorderDom(orderIds) {
      const cardsById = new Map(getCards().map(card => [card.dataset.shortcutId, card]));
      const addCard = root.querySelector('.quick-shortcut-card.is-add');

      orderIds.forEach(shortcutId => {
        const card = cardsById.get(shortcutId);
        if (card) root.insertBefore(card, addCard || null);
      });
    }

    function animateChangedCards(previousRects, previousOrder, nextOrder) {
      if (options.prefersReducedMotion?.()) return;

      getCards().forEach(card => {
        const shortcutId = card.dataset.shortcutId || '';
        if (previousOrder.indexOf(shortcutId) === nextOrder.indexOf(shortcutId)) return;

        const previousRect = previousRects.get(shortcutId);
        if (!previousRect) return;
        const nextRect = card.getBoundingClientRect();
        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (!deltaX && !deltaY) return;

        card.style.transition = 'none';
        card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        ownerWindow.requestAnimationFrame?.(() => {
          card.style.transition = '';
          card.style.transform = '';
        });
      });
    }

    function createDragPreview(drag) {
      const preview = drag.sourceCard.cloneNode(true);
      preview.classList.remove('is-actions-open');
      preview.classList.add('quick-shortcut-drag-preview');
      preview.removeAttribute('data-shortcut-id');
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      preview.style.width = `${drag.width}px`;
      preview.style.height = `${drag.height}px`;
      preview.querySelector('.quick-shortcut-actions')?.remove();

      const primaryClone = getPrimaryButton(preview);
      primaryClone?.removeAttribute('id');
      primaryClone?.removeAttribute('data-action');
      primaryClone?.removeAttribute('aria-controls');
      primaryClone?.removeAttribute('aria-expanded');
      if (primaryClone) primaryClone.tabIndex = -1;

      ownerDocument.body.appendChild(preview);
      drag.preview = preview;
      drag.sourceCard.classList.add('is-drag-slot');
      moveDragPreview(drag, drag.lastX, drag.lastY);
    }

    function moveDragPreview(drag, clientX, clientY) {
      if (!drag.preview) return;
      const left = clientX - drag.offsetX;
      const top = clientY - drag.offsetY;
      drag.preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }

    function releasePointerCapture(drag) {
      const handle = drag?.handle;
      const pointerId = drag?.pointerId;
      if (!handle?.releasePointerCapture || !handle?.hasPointerCapture?.(pointerId)) return;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already have been released by the browser.
      }
    }

    function cleanupDrag({ restoreOrder = false } = {}) {
      const drag = state.drag;
      if (!drag) return;

      if (restoreOrder) reorderDom(drag.originalIds);
      releasePointerCapture(drag);
      drag.preview?.remove();
      drag.sourceCard?.classList.remove('is-drag-slot');
      drag.sourceCard?.style.removeProperty('transition');
      drag.sourceCard?.style.removeProperty('transform');
      ownerDocument.body.classList.remove('quick-shortcut-list-dragging');
      state.drag = null;
    }

    function beginDragging(event) {
      const drag = state.drag;
      if (!drag || state.phase !== 'drag-armed') return;

      state.phase = 'dragging';
      drag.moved = true;
      createDragPreview(drag);
      ownerDocument.body.classList.add('quick-shortcut-list-dragging');
      updateDragging(event);
    }

    function updateDragging(event) {
      const drag = state.drag;
      if (!drag || state.phase !== 'dragging') return;

      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      moveDragPreview(drag, event.clientX, event.clientY);

      const targetIndex = findTargetSlotIndex(
        drag.slotTargets,
        event.clientX,
        event.clientY
      );
      if (targetIndex === -1 || targetIndex === drag.targetIndex) return;

      const previousOrder = [...drag.draftIds];
      const nextOrder = moveIdToIndex(previousOrder, drag.shortcutId, targetIndex);
      if (nextOrder.every((id, index) => id === previousOrder[index])) return;

      const previousRects = new Map(getCards().map(card => [
        card.dataset.shortcutId,
        card.getBoundingClientRect(),
      ]));

      drag.targetIndex = targetIndex;
      drag.draftIds = nextOrder;
      reorderDom(nextOrder);
      animateChangedCards(previousRects, previousOrder, nextOrder);
    }

    async function finishDragging() {
      const drag = state.drag;
      if (!drag) return;

      const nextOrder = [...drag.draftIds];
      const originalOrder = [...drag.originalIds];
      state.suppressClickCard = drag.sourceCard;
      cleanupDrag();
      closeActions({ flush: false });
      state.phase = 'committing';

      try {
        await options.onReorder?.({ ids: nextOrder, source: 'pointer' });
      } catch (error) {
        reorderDom(originalOrder);
        options.onError?.(error);
      } finally {
        state.phase = 'idle';
        state.suppressClickCard = null;
        await refresh('reorder');
      }
    }

    function cancelDragging({ closeMenu = true } = {}) {
      if (!state.drag) return;
      cleanupDrag({ restoreOrder: true });
      if (closeMenu) closeActions({ flush: false });
      state.phase = state.openActionsId ? 'actions-open' : 'idle';
      if (state.phase === 'idle') flushPendingRender();
    }

    function onPointerDown(event) {
      if (state.destroyed) return;

      const primary = event.target?.closest?.('.quick-shortcut-open');
      const card = event.target?.closest?.('.quick-shortcut-card[data-shortcut-id]');
      const action = event.target?.closest?.('[data-shortcut-command]');

      if (action && card && event.button === 0) {
        const command = action.dataset.shortcutCommand;
        if (command === 'reorder') {
          event.preventDefault();
          const rect = card.getBoundingClientRect();
          const orderIds = getOrderIds();
          state.phase = 'drag-armed';
          state.drag = {
            pointerId: event.pointerId,
            shortcutId: card.dataset.shortcutId,
            sourceCard: card,
            handle: action,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
            originalIds: orderIds,
            draftIds: [...orderIds],
            slotTargets: captureSlotTargets(),
            targetIndex: orderIds.indexOf(card.dataset.shortcutId),
            preview: null,
            moved: false,
          };

          try {
            action.setPointerCapture?.(event.pointerId);
          } catch {
            // Window capture listeners still keep the drag usable.
          }
          return;
        }

        if (command === 'edit' || command === 'remove') {
          state.phase = 'action-press';
          state.press = {
            pointerId: event.pointerId,
            shortcutId: card.dataset.shortcutId,
            command,
            target: action,
          };
          return;
        }
      }

      if (primary?.dataset?.action === 'add-quick-shortcut' && event.button === 0) {
        closeActions({ flush: false });
        state.phase = 'primary-press';
        state.press = { pointerId: event.pointerId, command: 'add', target: primary };
        return;
      }

      if (primary?.dataset?.action !== 'open-quick-shortcut' || !card) {
        if (event.button === 0 || event.button === 1) closeActions();
        return;
      }

      if (event.button === 0) {
        closeActions({ flush: false });
        state.phase = 'primary-press';
        state.press = {
          pointerId: event.pointerId,
          shortcutId: card.dataset.shortcutId,
          command: 'open',
          target: primary,
        };
        return;
      }

      if (event.button === 1) {
        event.preventDefault();
        closeActions({ flush: false });
        state.phase = 'middle-press';
        state.press = {
          pointerId: event.pointerId,
          shortcutId: card.dataset.shortcutId,
          command: 'open-background',
          target: primary,
        };
        void options.onOpenBackground?.({
          id: card.dataset.shortcutId,
          url: primary.dataset.shortcutUrl || '',
        });
        return;
      }

      if (event.button === 2) {
        state.phase = 'context-pending';
        state.press = {
          pointerId: event.pointerId,
          shortcutId: card.dataset.shortcutId,
          target: primary,
        };
      }
    }

    function onPointerMove(event) {
      const drag = state.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;

      if (state.phase === 'drag-armed') {
        const distance = Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY
        );
        if (distance < dragThreshold) return;
        beginDragging(event);
        return;
      }

      updateDragging(event);
    }

    function onPointerUp(event) {
      const drag = state.drag;
      if (drag && event.pointerId === drag.pointerId) {
        if (state.phase === 'dragging') {
          void finishDragging();
        } else {
          cleanupDrag();
          state.phase = state.openActionsId ? 'actions-open' : 'idle';
          if (state.phase === 'idle') flushPendingRender();
        }
        return;
      }

      if (state.press?.pointerId !== event.pointerId) return;
      if (state.phase === 'primary-press') schedulePressRelease('primary-press');
      if (state.phase === 'action-press') schedulePressRelease('action-press');
      if (state.phase === 'middle-press') schedulePressRelease('middle-press');
    }

    function onPointerCancel(event) {
      if (state.drag?.pointerId === event.pointerId) {
        cancelDragging();
        return;
      }

      if (state.press?.pointerId === event.pointerId) {
        enterIdle();
      }
    }

    function onClick(event) {
      const card = event.target?.closest?.('.quick-shortcut-card[data-shortcut-id]');
      if (state.suppressClickCard && card === state.suppressClickCard) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        state.suppressClickCard = null;
        return;
      }

      const action = event.target?.closest?.('[data-shortcut-command]');
      if (action && card) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        const shortcutId = card.dataset.shortcutId || '';
        const command = action.dataset.shortcutCommand;

        if (command === 'reorder') {
          enterIdle({ flush: false });
          return;
        }

        closeActions({ flush: false });
        state.phase = command === 'remove' ? 'committing' : 'idle';
        const primary = getPrimaryButton(card);

        if (command === 'edit') {
          void Promise.resolve(options.onEdit?.({ id: shortcutId, trigger: primary }))
            .catch(error => options.onError?.(error))
            .finally(() => {
              state.phase = 'idle';
              flushPendingRender();
            });
        }

        if (command === 'remove') {
          void Promise.resolve(options.onRemove?.({ id: shortcutId }))
            .then(() => refresh('remove'))
            .catch(error => options.onError?.(error))
            .finally(() => {
              state.phase = 'idle';
              flushPendingRender();
            });
        }
        return;
      }

      const primary = event.target?.closest?.('.quick-shortcut-open');
      if (!primary) return;
      const actionName = primary.dataset.action;
      if (actionName !== 'open-quick-shortcut' && actionName !== 'add-quick-shortcut') return;

      event.stopImmediatePropagation?.();
      clearReleaseTimer();
      state.phase = 'idle';
      state.press = null;

      if (actionName === 'add-quick-shortcut') {
        options.onAdd?.({ trigger: primary });
      } else {
        void options.onOpenCurrent?.({
          id: card?.dataset?.shortcutId || '',
          url: primary.dataset.shortcutUrl || '',
        });
      }

      flushPendingRender();
    }

    function onAuxClick(event) {
      const primary = event.target?.closest?.('.quick-shortcut-open[data-action="open-quick-shortcut"]');
      if (!primary || event.button !== 1) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      clearReleaseTimer();
      state.phase = 'idle';
      state.press = null;
      flushPendingRender();
    }

    function onContextMenu(event) {
      const primary = event.target?.closest?.('.quick-shortcut-open[data-action="open-quick-shortcut"]');
      if (!primary) {
        closeActions();
        return;
      }

      event.preventDefault();
      openActions(primary);
    }

    function onKeyDown(event) {
      const primary = event.target?.closest?.('.quick-shortcut-open[data-action="open-quick-shortcut"]');
      const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);

      if (primary && isContextKey) {
        event.preventDefault();
        openActions(primary, { focusActions: true });
        return;
      }

      if (event.key !== 'Escape') return;
      if (state.phase === 'dragging' || state.phase === 'drag-armed') {
        event.preventDefault();
        cancelDragging();
        return;
      }

      if (state.openActionsId) {
        event.preventDefault();
        closeActions({ restoreFocus: true });
      }
    }

    function onDocumentPointerDown(event) {
      if (root.contains(event.target)) return;
      if (event.button === 0 || event.button === 1 || event.button === 2) {
        closeActions();
      }
    }

    function onWindowBlur() {
      if (state.drag) cancelDragging();
      else closeActions();
      if (state.press) enterIdle();
    }

    async function refresh(reason = 'explicit') {
      if (state.destroyed || typeof options.loadItems !== 'function') return [];

      const generation = ++state.requestedGeneration;
      const items = await options.loadItems({ reason });
      if (generation !== state.requestedGeneration || state.destroyed) return items;

      state.pendingSnapshot = { items, reason, generation };

      if (
        state.openActionsId
        && !items.some(item => item.id === state.openActionsId)
      ) {
        closeActions({ flush: false });
      }

      applyPendingSnapshot();
      return items;
    }

    function mount() {
      if (state.mounted || state.destroyed) return;
      state.mounted = true;

      root.addEventListener('pointerdown', onPointerDown, true);
      root.addEventListener('click', onClick, true);
      root.addEventListener('auxclick', onAuxClick, true);
      root.addEventListener('contextmenu', onContextMenu);
      root.addEventListener('keydown', onKeyDown, true);
      ownerDocument.addEventListener('pointerdown', onDocumentPointerDown, true);
      ownerWindow.addEventListener('pointermove', onPointerMove, true);
      ownerWindow.addEventListener('pointerup', onPointerUp, true);
      ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
      ownerWindow.addEventListener('blur', onWindowBlur);
    }

    function destroy() {
      if (!state.mounted || state.destroyed) return;
      state.destroyed = true;
      state.mounted = false;
      clearReleaseTimer();
      cleanupDrag({ restoreOrder: true });

      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('auxclick', onAuxClick, true);
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('keydown', onKeyDown, true);
      ownerDocument.removeEventListener('pointerdown', onDocumentPointerDown, true);
      ownerWindow.removeEventListener('pointermove', onPointerMove, true);
      ownerWindow.removeEventListener('pointerup', onPointerUp, true);
      ownerWindow.removeEventListener('pointercancel', onPointerCancel, true);
      ownerWindow.removeEventListener('blur', onWindowBlur);
    }

    function getState() {
      return {
        phase: state.phase,
        openActionsId: state.openActionsId,
        renderLocked: isRenderLocked(),
        draggingId: state.drag?.shortcutId || '',
      };
    }

    return Object.freeze({
      mount,
      destroy,
      refresh,
      closeActions,
      getOpenActionsId: () => state.openActionsId,
      isRenderLocked,
      getState,
    });
  }

  globalScope.TabHarborQuickShortcutsController = Object.freeze({
    createController,
    findTargetSlotIndex,
    moveIdToIndex,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
