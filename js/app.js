import { APP_BUILD_VERSION, CACHE_BUST_VERSION } from './constants.js?v=20260720notes';
import { getState, getDefaultWeek, resetStateToDefaults, syncCompatibilityViews, setWeekStart, setMioChef, setNumWeeks, setWeeklyMioChef, setManualDailyNote } from './state.js';
import { normalizeWeekStart, getPlanningHorizon, formatDate } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory } from './storage.js?v=20260720notes';
import { addChef, createBlankChefDraft, createChefDraft, getChefById, removeChef, updateChef } from './staff.js';
import { addAvailabilityEntry, removeAvailabilityEntry, updateAvailabilityField, addAdditionalChefRequest, updateAdditionalChefRequest, removeAdditionalChefRequest, validateAdditionalChefDate, validateAdditionalChefCount } from './weekly-inputs.js';
import {
  renderAll,
  renderPlanningHorizonSummary,
  renderResultsPanel,
  updateRotaScrollAccessibility,
  renderAdditionalChefRequirements,
  renderAvailabilityTable,
  renderStaffTable,
  renderReadinessPanel,
  openChefModal,
  closeChefModal,
  populateChefModal,
  readChefDraftFromModal,
  clearChefModalError,
  showChefModalError,
  setChefRemovalConfirmation,
  syncChefChoiceChipState
} from './render.js?v=20260720notes';
import { renderAssignmentConflict, renderAssignmentConflictPreview, renderChefSelector } from './render.js?v=20260720notes';
import { applyManualAssignment, findDuplicateCoreAssignment, getChefConcerns, rateManualAssignmentActions, redoManualEdit, resetAllManualEdits, resetManualCell, undoManualEdit } from './manual-edit.js';
import { upsertPublishedHistory, upsertPublishedWeeks } from './history.js';
import { openPrintWindow } from './print.js?v=20260720tarleton';
import { createBackup, createBackupFilename, restoreBackup, serializeBackup } from './backup.js';
import { buildWeekClipboardText, icon } from './ui.js?v=20260719zf';
import { initChefPresence } from './chef-presence.js?v=20260720cp';
import {
  closeContextPanel,
  dataSnapshot,
  emphasizeIssueCell,
  ensureCoordinatedUiState,
  markUnsaved,
  navigateIssue,
  openContextPanel,
  persistUiPreferences,
  recordHistory,
  redoDataChange,
  resetView,
  setDensity,
  setSaveState,
  showToast,
  toggleFullScreen,
  undoDataChange,
  updateDocumentUiState
} from './ui-upgrade.js?v=20260720ui';

const state = getState();
let editingReqDate = null;
let activeChefId = null;
let activeChefMode = 'create';
let activeChefTriggerSelector = '#addChefBtn';
let removeChefConfirmationOpen = false;
let activeAssignmentTrigger = null;
let issueCloseTimer = 0;
let openWarningId = null;
let lastInputModality = 'pointer';
let warningTouchStart = null;
let suppressWarningClick = false;
let undoToastTimer = 0;
let generationActive = false;
let generationSlowTimer = 0;
const fieldHistorySnapshots = new WeakMap();
let activeManualNoteDate = '';
let activeManualNoteTrigger = null;

const HOVER_CAPABILITY_QUERY = '(hover: hover) and (pointer: fine)';

function supportsGenuineHover() {
  return typeof window.matchMedia === 'function' && window.matchMedia(HOVER_CAPABILITY_QUERY).matches;
}

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`GT Rota Builder is missing required element #${id}. index.html is the canonical entry page.`);
  }
  return element;
}

function persistState() {
  setSaveState(state, 'saving', 'Writing rota data to this browser.');
  state.uiState.saveState = 'saved';
  state.uiState.saveDetail = 'Stored in this browser.';
  const appSaved = saveAppState(state);
  saveHistory(state.history);
  setSaveState(state, appSaved ? 'saved' : 'failed', appSaved ? 'Stored in this browser.' : 'Browser storage is unavailable or full.');
  const saveButton = document.querySelector('[data-open-context="save"] strong');
  if (saveButton) saveButton.textContent = appSaved ? 'Saved' : 'Save failed';
  if (!appSaved) showToast('Error saving rota', 'error');
  return appSaved;
}

function beginDataAction() {
  return dataSnapshot(state);
}

function finishDataAction(description, before, toastMessage = '') {
  recordHistory(state, description, before);
  persistState();
  if (toastMessage) showToast(toastMessage);
}

function refreshAll() {
  renderAll();
}

function announce(message) {
  const live = document.getElementById('manualEditLive');
  if (live) live.textContent = message;
}

function showUndoToast(message) {
  window.clearTimeout(undoToastTimer);
  document.querySelector('[data-undo-toast]')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="undo-toast print-hidden" data-undo-toast role="status"><span>${message}</span><button type="button" data-toast-undo>${icon('undo')} Undo</button><button type="button" class="toast-close icon-button" data-close-undo-toast aria-label="Close undo notification">${icon('close')}</button></div>`);
  announce(`${message}. Undo available.`);
  undoToastTimer = window.setTimeout(() => document.querySelector('[data-undo-toast]')?.remove(), 8000);
}

function getIssuePopover(button) {
  return button ? document.getElementById(button.getAttribute('aria-controls')) : null;
}

function positionIssuePopover(button, popover) {
  const anchor = button.getBoundingClientRect();
  const gap = 7;
  popover.style.visibility = 'hidden';
  popover.hidden = false;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.right - width));
  const fitsAbove = anchor.top >= height + gap + 8;
  const top = fitsAbove
    ? anchor.top - height - gap
    : Math.min(window.innerHeight - height - 8, anchor.bottom + gap);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.max(8, Math.round(top))}px`;
  popover.dataset.placement = fitsAbove ? 'above' : 'below';
  popover.style.visibility = '';
}

function removeMobileIssueSheet() {
  document.querySelector('[data-mobile-issue-sheet]')?.remove();
}

function resetIssueElement(button) {
  button.setAttribute('aria-expanded', 'false');
  delete button.dataset.issuePinned;
  const originalId = button.dataset.issuePopoverId || button.getAttribute('aria-controls');
  if (originalId) button.setAttribute('aria-controls', originalId);
  delete button.dataset.issuePopoverId;
  const popover = originalId ? document.getElementById(originalId) : getIssuePopover(button);
  if (!popover) return;
  popover.hidden = true;
  popover.removeAttribute('style');
  delete popover.dataset.placement;
  popover.removeAttribute('aria-hidden');
}

function closeIssuePopover(button = null, { restoreFocus = false } = {}) {
  window.clearTimeout(issueCloseTimer);
  const activeButton = button || (openWarningId ? document.querySelector(`[data-issue-toggle][aria-controls="${openWarningId}"], [data-issue-toggle][data-issue-popover-id="${openWarningId}"]`) : null);
  document.querySelectorAll('[data-issue-toggle]').forEach(resetIssueElement);
  removeMobileIssueSheet();
  openWarningId = null;
  if (restoreFocus && activeButton?.isConnected) {
    // Focus restoration is not a fresh request to reopen the warning.
    lastInputModality = 'pointer';
    activeButton.focus();
  }
}

function openMobileIssueSheet(button, popover) {
  const popoverId = popover.id;
  const sheetId = 'mobile-rule-issue-sheet';
  document.body.insertAdjacentHTML('beforeend', `<div class="mobile-issue-backdrop print-hidden" data-mobile-issue-sheet><section id="${sheetId}" class="mobile-issue-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileRuleIssueTitle"><div class="mobile-issue-sheet-head"><h2 id="mobileRuleIssueTitle">Rule issue</h2><button type="button" class="secondary" data-close-mobile-issue>Close</button></div><div class="mobile-issue-sheet-body">${popover.innerHTML}</div></section></div>`);
  button.dataset.issuePopoverId = popoverId;
  button.setAttribute('aria-controls', sheetId);
  document.querySelector('[data-close-mobile-issue]')?.focus({ preventScroll: true });
}

function openIssuePopover(button, { pinned = false } = {}) {
  window.clearTimeout(issueCloseTimer);
  closeIssuePopover();
  const popover = getIssuePopover(button);
  if (!popover) return;
  openWarningId = popover.id;
  button.setAttribute('aria-expanded', 'true');
  if (pinned) button.dataset.issuePinned = 'true';
  if (!supportsGenuineHover()) openMobileIssueSheet(button, popover);
  else positionIssuePopover(button, popover);
}

function scheduleIssuePopoverClose(button) {
  window.clearTimeout(issueCloseTimer);
  issueCloseTimer = window.setTimeout(() => {
    const popover = getIssuePopover(button);
    if (button.dataset.issuePinned === 'true' || button.matches(':hover') || popover?.matches(':hover') || popover?.contains(document.activeElement) || button === document.activeElement) return;
    closeIssuePopover(button);
  }, 60);
}

function closeChefSelector({ restoreFocus = true } = {}) {
  document.querySelector('.chef-selector')?.remove();
  document.querySelector('.chef-selector-backdrop')?.remove();
  if (restoreFocus) activeAssignmentTrigger?.focus();
  document.querySelectorAll('.edit-selected').forEach((element) => element.classList.remove('edit-selected'));
  state.uiState.manualEditState = null;
  activeAssignmentTrigger = null;
}

function openAssignmentSelector(button) {
  closeChefSelector({ restoreFocus: false });
  document.dispatchEvent(new CustomEvent('rota:before-results-render'));
  activeAssignmentTrigger = button;
  const cell = button.closest('[data-rota-cell], .day-rota-assignment');
  cell?.classList.add('edit-selected');
  state.uiState.selectedCell = {
    weekIndex: Number(button.dataset.weekIndex),
    date: button.dataset.date,
    section: button.dataset.section
  };
  state.uiState.manualEditState = { ...state.uiState.selectedCell, dirtySelection: false };
  document.body.insertAdjacentHTML('beforeend', renderChefSelector({
    weekIndex: Number(button.dataset.weekIndex),
    date: button.dataset.date,
    section: button.dataset.section
  }));
  document.querySelector('.chef-option-select')?.focus();
}

function openAssignmentConflict({ selector, weekIndex, date, section, chef, duplicate, current }) {
  const week = state.generatedRotas.latestResult.weeks[weekIndex];
  const actionRatings = rateManualAssignmentActions({
    state,
    overallResult: state.generatedRotas.latestResult,
    weekIndex,
    date,
    section,
    chefName: chef,
    floatAction: 'add'
  });
  const swapWarnings = current && section !== 'Float'
    ? (getChefConcerns({ state, week, date, section: duplicate.section, chefName: current }) || []).filter((warning) => warning !== 'Already assigned elsewhere that day')
    : [];
  selector.previousElementSibling?.remove();
  selector.outerHTML = renderAssignmentConflict({ weekIndex, date, section, chef, duplicateSection: duplicate.section, currentChef: current, swapWarnings, actionRatings });
  const conflictSelector = document.querySelector('.conflict-selector');
  if (conflictSelector) conflictSelector._actionRatings = actionRatings;
  document.getElementById('assignmentConflictTitle')?.focus();
  announce(`${chef} is already assigned to ${duplicate.section}. Choose an action before applying any change.`);
}

function updateConflictPreview(selector) {
  const action = selector.querySelector('[data-conflict-action]')?.value || '';
  const apply = selector.querySelector('[data-apply-conflict]');
  const preview = selector.querySelector('[data-conflict-preview]');
  const chef = selector.dataset.conflictChef;
  const current = selector.dataset.currentChef;
  const target = selector.dataset.section;
  const previous = selector.dataset.duplicateSection;
  const rating = selector._actionRatings?.find((item) => item.action === action) || null;
  apply.disabled = !action;
  preview.innerHTML = renderAssignmentConflictPreview({ action, chef, targetSection: target, currentChef: current, previousSection: previous, rating });
}

function openResetManualConfirmation(button) {
  closeChefSelector({ restoreFocus: false });
  activeAssignmentTrigger = button;
  const count = Object.keys(state.manualEditing?.edits || {}).length;
  document.body.insertAdjacentHTML('beforeend', `<div class="chef-selector-backdrop" data-close-chef-selector></div><section class="chef-selector conflict-selector reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="resetManualTitle" aria-describedby="resetManualMessage">
    <div class="chef-selector-head"><div><h3 id="resetManualTitle" tabindex="-1">Reset ${count} manual change${count === 1 ? '' : 's'} and restore the generated rota?</h3><p id="resetManualMessage">Assignments, warnings, totals and score will return to the generated version. Your setup and current week, day and view will stay unchanged.</p></div><button type="button" class="secondary icon-button" data-close-chef-selector aria-label="Keep changes and close">${icon('close')}</button></div>
    <div class="chef-selector-actions"><button type="button" class="secondary" data-close-chef-selector>Keep changes</button><button type="button" class="danger" data-confirm-reset-manual>Reset rota</button></div>
  </section>`);
  document.getElementById('resetManualTitle')?.focus();
}

function updateGenerationProgress(stage, step, total = 6) {
  const progress = document.getElementById('generationProgress');
  if (!progress) return;
  progress.classList.remove('hidden');
  progress.innerHTML = `<div class="generation-progress-head"><strong>${stage}</strong><span>Step ${step} of ${total}</span></div><progress max="${total}" value="${step}">${step} of ${total}</progress><p data-generation-slow></p>`;
}

async function generateRota({ forceBestAvailable = false } = {}) {
  if (generationActive) return;
  const readiness = renderReadinessPanel();
  if (readiness?.status === 'blocked' && !forceBestAvailable) {
    document.querySelector('[data-generate-best-available]')?.focus();
    announce('Likely rule issues found. Choose Generate best available rota or Return to setup.');
    return;
  }
  generationActive = true;
  state.uiState.generationState = 'running';
  const resultsContainer = document.getElementById('results');
  resultsContainer?.classList.add('generation-loading');
  if (resultsContainer?.querySelector('.rota-empty-state')) {
    resultsContainer.innerHTML = `<section class="rota-skeleton" aria-label="Building rota" aria-busy="true">
      <div class="skeleton-heading"></div>
      <div class="skeleton-grid">${Array.from({ length: 42 }, () => '<span></span>').join('')}</div>
    </section>`;
  }
  const buttons = document.querySelectorAll('[data-empty-generate],[data-generate-best-available],[data-regenerate]');
  buttons.forEach((button) => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
  updateGenerationProgress('Checking availability', 1);
  generationSlowTimer = window.setTimeout(() => {
    const slow = document.querySelector('[data-generation-slow]');
    if (slow) slow.textContent = 'Still working. Complex availability can take a little longer.';
  }, 4000);
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  const weeks = Number(state.weeklyInputs.numWeeks || 1);
  updateGenerationProgress(`Building week 1 of ${weeks}`, 2);
  try {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    renderResultsPanel({ forceBestAvailable: true });
    updateGenerationProgress('Preparing results', 6);
    persistState();
    state.uiState.generationState = 'completed';
    showToast(readiness?.status === 'ready' ? 'Rota generated' : 'Best available rota generated', readiness?.status === 'ready' ? 'success' : 'warning');
    announce(readiness?.status === 'ready' ? 'Rota generated.' : 'Best available draft rota generated. Review unresolved rule issues.');
  } catch (error) {
    state.uiState.lastError = error.message;
    state.uiState.generationState = 'failed';
    showToast('Error generating rota', 'error');
    renderResultsPanel({ showEmpty: true });
    announce(`Rota generation failed: ${error.message}`);
  } finally {
    window.clearTimeout(generationSlowTimer);
    generationActive = false;
    resultsContainer?.classList.remove('generation-loading');
    buttons.forEach((button) => { button.disabled = false; button.removeAttribute('aria-busy'); });
    window.setTimeout(() => document.getElementById('generationProgress')?.classList.add('hidden'), 500);
  }
}

async function copySelectedWeek() {
  const text = buildWeekClipboardText({ state, overallResult: state.generatedRotas.latestResult, weekIndex: state.uiState.selectedResultWeekIndex || 0 });
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea'); area.value = text; area.className = 'clipboard-fallback'; document.body.appendChild(area); area.select();
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      area.remove();
    }
    showUndoToast('Week copied to clipboard.');
  } catch { announce('Could not copy automatically. Select the rota text and copy it manually.'); }
}

function filterChefOptions(selector) {
  const query = selector.querySelector('[data-chef-search]')?.value.trim().toLowerCase() || '';
  const active = selector.querySelector('[data-chef-filter][aria-pressed="true"]')?.dataset.chefFilter || 'all';
  let alternatives = 0;
  selector.querySelectorAll('[data-chef-option]').forEach((option) => {
    const current = option.dataset.current === 'true';
    const matchesName = !query || option.dataset.chefName.includes(query);
    const matchesType = active === 'all' || (active === 'valid' ? option.dataset.valid === 'true' : option.dataset.valid === 'false');
    const visible = current || (matchesName && matchesType);
    option.hidden = !visible;
    option.classList.toggle('filter-pinned', current && !(matchesName && matchesType));
    if (visible && !current) alternatives += 1;
  });
  selector.querySelectorAll('[data-option-group]').forEach((group) => { group.hidden = !group.querySelector('[data-chef-option]:not([hidden])'); });
  selector.querySelector('[data-chef-empty]')?.classList.toggle('hidden', alternatives > 0 || active === 'all' && !query);
}

function refreshEditedRota(message = '') {
  renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
  state.generatedRotas.current = state.generatedRotas.latestResult?.weeks?.[state.uiState.selectedResultWeekIndex || 0] || null;
  persistState();
  if (message) announce(message);
}

function showBackupMessage(message, tone = '') {
  const element = requireElement('backupMessage');
  element.textContent = message;
  element.className = `backup-message${tone ? ` ${tone}` : ''}`;
}

function syncRestoredInterface() {
  requireElement('weekStart').value = normalizeWeekStart(state.weeklyInputs.weekStart || getDefaultWeek());
  requireElement('numWeeks').value = String(state.weeklyInputs.numWeeks || 1);
  requireElement('mioChef').value = state.weeklyInputs.mioChef || '';
  renderPlanningHorizonSummary();
  renderAdditionalChefRequirements();
  renderStaffTable();
  renderAvailabilityTable();
  const results = requireElement('results');
  results.innerHTML = '<p class="section-note">Backup restored. The rota has not been regenerated.</p>';
  requireElement('printRotaBtn').disabled = true;
}

function downloadBackup() {
  try {
    const now = new Date();
    const json = serializeBackup(createBackup(localStorage, now));
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = createBackupFilename(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showBackupMessage('Backup downloaded successfully.', 'success');
  } catch (error) {
    showBackupMessage(error.message || 'The backup could not be downloaded.', 'error');
  }
}

async function restoreBackupFile(file) {
  if (!file) return;
  showBackupMessage('');
  try {
    const text = await file.text();
    const result = await restoreBackup(text, {
      confirmRestore: () => window.confirm('Restore this backup? This will replace all current GT Rota Builder data.')
    });
    if (result.cancelled) {
      showBackupMessage('Restore cancelled.');
      return;
    }
    resetStateToDefaults();
    migrateStorageIfNeeded();
    loadAppState();
    state.history = loadHistory();
    syncCompatibilityViews();
    syncRestoredInterface();
    const created = new Date(result.backup.createdAt).toLocaleString('en-GB');
    showBackupMessage(`Backup restored successfully. Backup created ${created}.`, 'success');
  } catch (error) {
    showBackupMessage(error.message || 'The backup could not be restored.', 'error');
  }
}

function focusSelector(selector) {
  if (!selector) return;
  const target = document.querySelector(selector);
  if (target) {
    target.focus();
    return;
  }
  window.setTimeout(() => {
    document.querySelector(selector)?.focus();
  }, 0);
}

function getFocusableElements(container) {
  return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && element.offsetParent !== null);
}

function getCurrentChefNameForConfirmation() {
  return requireElement('chefNameInput').value.trim() || getChefById(activeChefId)?.name || 'this chef';
}

function hideChefRemovalConfirmation({ restoreFocus = false } = {}) {
  removeChefConfirmationOpen = false;
  setChefRemovalConfirmation(false, getCurrentChefNameForConfirmation());
  if (restoreFocus) focusSelector('#removeChefBtn');
}

function openChefEditor({ chefId = null, triggerSelector = '#addChefBtn' }) {
  activeChefId = chefId;
  activeChefMode = chefId ? 'edit' : 'create';
  activeChefTriggerSelector = triggerSelector;
  removeChefConfirmationOpen = false;

  const draft = chefId ? createChefDraft(getChefById(chefId)) : createBlankChefDraft();
  populateChefModal({
    chef: draft,
    mode: activeChefMode,
    showRemove: !!chefId
  });
  requireElement('chefRoleInput').dataset.previousRole = draft.role || '';
  openChefModal();
  focusSelector('#chefNameInput');
}

function closeChefEditor({ restoreFocus = true, focusAfterCloseSelector = '' } = {}) {
  closeChefModal();
  hideChefRemovalConfirmation();
  clearChefModalError();
  activeChefId = null;
  activeChefMode = 'create';
  const selector = focusAfterCloseSelector || activeChefTriggerSelector || '#addChefBtn';
  activeChefTriggerSelector = '#addChefBtn';
  if (restoreFocus) focusSelector(selector);
}

function handleChefSave(event) {
  event.preventDefault();
  const before = beginDataAction();
  const wasEditingChef = !!activeChefId;
  const draft = readChefDraftFromModal();
  const result = activeChefId ? updateChef(activeChefId, draft) : addChef(draft);
  if (!result.valid) {
    showChefModalError(result.message, result.field);
    focusSelector(result.field ? `#${result.field}` : '#chefNameInput');
    return;
  }

  const focusTargetSelector = result.chef?.id ? `[data-open-chef-id="${result.chef.id}"]` : '#addChefBtn';
  closeChefEditor({ restoreFocus: false });
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
  finishDataAction(wasEditingChef ? 'Chef settings changed' : 'Chef added', before, wasEditingChef ? 'Chef updated' : 'Chef added');
  focusSelector(focusTargetSelector);
}

function handleChefRemoval() {
  if (!activeChefId) return;
  const before = beginDataAction();
  removeChef(activeChefId);
  closeChefEditor({ restoreFocus: false });
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
  finishDataAction('Chef removed', before, 'Chef removed');
  focusSelector('#addChefBtn');
}

function openAdditionalChefModal(editDate) {
  const horizon = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  const fmt = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const dateInput = requireElement('additionalChefDate');
  const countInput = requireElement('additionalChefCount');
  const noteInput = requireElement('additionalChefNote');
  const titleEl = requireElement('additionalChefModalTitle');
  const saveBtn = requireElement('saveAdditionalChefBtn');

  requireElement('additionalChefWeekRange').textContent = `Valid dates: ${fmt(horizon.startDate)} – ${fmt(horizon.endDate)}`;
  dateInput.min = horizon.start;
  dateInput.max = horizon.end;
  requireElement('additionalChefError').textContent = '';

  if (editDate) {
    editingReqDate = editDate;
    const request = (state.weeklyInputs.additionalChefRequirements || []).find((entry) => entry.date === editDate);
    dateInput.value = editDate;
    countInput.value = request ? request.count : 1;
    noteInput.value = request?.note || '';
    titleEl.textContent = 'Edit additional chef';
    saveBtn.textContent = 'Save';
  } else {
    editingReqDate = null;
    const existing = new Set((state.weeklyInputs.additionalChefRequirements || []).map((entry) => entry.date));
    let defaultDate = horizon.start;
    for (let offset = 0; offset < (state.weeklyInputs.numWeeks || 1) * 7; offset += 1) {
      const date = new Date(horizon.startDate);
      date.setDate(horizon.startDate.getDate() + offset);
      const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (!existing.has(dateString)) {
        defaultDate = dateString;
        break;
      }
    }
    dateInput.value = defaultDate;
    countInput.value = 1;
    noteInput.value = '';
    titleEl.textContent = 'Add additional chef';
    saveBtn.textContent = 'Add';
  }

  requireElement('additionalChefModal').classList.add('open');
  dateInput.focus();
}

function closeAdditionalChefModal() {
  requireElement('additionalChefModal').classList.remove('open');
  const trigger = document.getElementById('addAdditionalChefBtn');
  if (trigger) trigger.focus();
  editingReqDate = null;
}

function handleAdditionalChefSave() {
  const before = beginDataAction();
  const wasEditingRequest = !!editingReqDate;
  const dateInput = requireElement('additionalChefDate');
  const countInput = requireElement('additionalChefCount');
  const noteInput = requireElement('additionalChefNote');
  const errorEl = requireElement('additionalChefError');

  const dateErr = validateAdditionalChefDate(dateInput.value, state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  if (dateErr) {
    errorEl.textContent = dateErr;
    dateInput.focus();
    return;
  }

  const countErr = validateAdditionalChefCount(countInput.value);
  if (countErr) {
    errorEl.textContent = countErr;
    countInput.focus();
    return;
  }

  const count = Number.parseInt(countInput.value, 10);
  const date = dateInput.value;
  const note = noteInput.value.trim();

  if (editingReqDate) {
    updateAdditionalChefRequest(editingReqDate, date, count, note);
  } else {
    addAdditionalChefRequest(date, count, note);
  }

  closeAdditionalChefModal();
  renderAdditionalChefRequirements();
  renderResultsPanel();
  finishDataAction(wasEditingRequest ? 'Additional chef request changed' : 'Additional chef request added', before, 'Staffing request saved');
}

function openManualNoteEditor(button) {
  activeManualNoteDate = button.dataset.date;
  activeManualNoteTrigger = button;
  const modal = requireElement('manualNoteModal');
  const text = requireElement('manualNoteText');
  requireElement('manualNoteDescription').textContent = `Daily note for ${formatDate(activeManualNoteDate)}.`;
  text.value = state.weeklyInputs.manualDailyNotes?.[activeManualNoteDate] || '';
  requireElement('removeManualNoteBtn').classList.toggle('hidden', !text.value);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  text.focus();
}

function closeManualNoteEditor({ restoreFocus = true } = {}) {
  const modal = requireElement('manualNoteModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (restoreFocus && activeManualNoteTrigger?.isConnected) activeManualNoteTrigger.focus();
  activeManualNoteDate = '';
  activeManualNoteTrigger = null;
}

function saveManualNote(value, description) {
  if (!activeManualNoteDate) return;
  const before = beginDataAction();
  setManualDailyNote(activeManualNoteDate, value);
  (state.generatedRotas.latestResult?.weeks || []).forEach((week) => {
    week.inputs ||= {};
    week.inputs.manualDailyNotes = { ...(state.weeklyInputs.manualDailyNotes || {}) };
  });
  closeManualNoteEditor({ restoreFocus: false });
  renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
  finishDataAction(description, before, description);
}

function loadInitialState() {
  migrateStorageIfNeeded();
  loadAppState();
  state.history = loadHistory();
  syncCompatibilityViews();

  if (!state.weeklyInputs.weekStart) {
    state.weeklyInputs.weekStart = normalizeWeekStart(getDefaultWeek());
  }

  requireElement('weekStart').value = normalizeWeekStart(state.weeklyInputs.weekStart || getDefaultWeek());
  requireElement('numWeeks').value = String(state.weeklyInputs.numWeeks || 1);
  requireElement('mioChef').value = state.weeklyInputs.mioChef || '';

  const buildVersionEl = document.getElementById('buildVersion');
  if (buildVersionEl) buildVersionEl.textContent = APP_BUILD_VERSION;
}

function attachEvents() {
  document.addEventListener('toggle', (event) => {
    const summary = event.target.closest?.('[data-summary-key]');
    if (!summary) return;
    state.uiState.expandedSections[summary.dataset.summaryKey] = summary.open;
    persistUiPreferences(state);
  }, true);
  document.addEventListener('dblclick', (event) => {
    const assignment = event.target.closest?.('[data-edit-assignment]');
    if (!assignment) return;
    event.preventDefault();
    state.uiState.editMode = true;
    openAssignmentSelector(assignment);
  });
  window.addEventListener('resize', () => updateRotaScrollAccessibility(document));
  window.addEventListener('resize', () => {
    closeIssuePopover();
  });
  window.addEventListener('orientationchange', () => closeIssuePopover());
  document.addEventListener('rota:before-results-render', () => closeIssuePopover());
  document.addEventListener('scroll', (event) => {
    if (event.target?.closest?.('.rota-table-scroll') || event.target?.classList?.contains('rota-table-scroll')) closeIssuePopover();
  }, true);
  document.addEventListener('pointerdown', (event) => {
    lastInputModality = 'pointer';
    if (event.pointerType === 'touch') {
      warningTouchStart = { x: event.clientX, y: event.clientY, target: event.target.closest?.('[data-issue-toggle]') || null };
      suppressWarningClick = false;
    }
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || !warningTouchStart) return;
    if (Math.abs(event.clientX - warningTouchStart.x) > 10 || Math.abs(event.clientY - warningTouchStart.y) > 10) {
      suppressWarningClick = true;
      closeIssuePopover();
    }
  }, true);
  document.addEventListener('pointerup', () => { warningTouchStart = null; }, true);
  document.addEventListener('touchstart', (event) => {
    lastInputModality = 'pointer';
    const touch = event.touches?.[0];
    if (!touch) return;
    warningTouchStart = { x: touch.clientX, y: touch.clientY, target: event.target.closest?.('[data-issue-toggle]') || null };
    suppressWarningClick = false;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (event) => {
    const touch = event.touches?.[0];
    if (!touch || !warningTouchStart) return;
    if (Math.abs(touch.clientX - warningTouchStart.x) > 10 || Math.abs(touch.clientY - warningTouchStart.y) > 10) {
      suppressWarningClick = true;
      closeIssuePopover();
    }
  }, { capture: true, passive: true });
  document.addEventListener('touchend', () => { warningTouchStart = null; }, { capture: true, passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    lastInputModality = 'keyboard';
  }, true);
  window.addEventListener('blur', () => { lastInputModality = 'pointer'; });
  window.addEventListener('resize', () => {
    const button = document.querySelector('[data-issue-toggle][aria-expanded="true"]');
    const popover = getIssuePopover(button);
    if (supportsGenuineHover() && button && popover) positionIssuePopover(button, popover);
  });
  const handleIssueMouseOver = (event) => {
    if (!supportsGenuineHover()) return;
    const button = event.target.closest?.('[data-issue-toggle]');
    const popover = event.target.closest?.('.issue-popover');
    if (button && !button.contains(event.relatedTarget)) openIssuePopover(button);
    if (popover) window.clearTimeout(issueCloseTimer);
  };
  const handleIssueMouseOut = (event) => {
    if (!supportsGenuineHover()) return;
    const button = event.target.closest?.('[data-issue-toggle]');
    const popover = event.target.closest?.('.issue-popover');
    if (button && !button.contains(event.relatedTarget)) scheduleIssuePopoverClose(button);
    if (popover && !popover.contains(event.relatedTarget)) {
      const owner = document.querySelector(`[data-issue-toggle][aria-controls="${popover.id}"]`);
      if (owner) scheduleIssuePopoverClose(owner);
    }
  };
  let hoverHandlersAttached = false;
  const hoverMedia = typeof window.matchMedia === 'function' ? window.matchMedia(HOVER_CAPABILITY_QUERY) : null;
  const syncIssueHoverHandlers = () => {
    const shouldAttach = !!hoverMedia?.matches;
    if (shouldAttach === hoverHandlersAttached) return;
    hoverHandlersAttached = shouldAttach;
    document[shouldAttach ? 'addEventListener' : 'removeEventListener']('mouseover', handleIssueMouseOver);
    document[shouldAttach ? 'addEventListener' : 'removeEventListener']('mouseout', handleIssueMouseOut);
    if (!shouldAttach) closeIssuePopover();
  };
  syncIssueHoverHandlers();
  hoverMedia?.addEventListener?.('change', syncIssueHoverHandlers);
  document.addEventListener('focusin', (event) => {
    if (event.target.matches?.('.entry-chef,.entry-type,.entry-start-date,.entry-finish-date,.entry-notes')) {
      fieldHistorySnapshots.set(event.target, beginDataAction());
    }
    const button = event.target.closest?.('[data-issue-toggle]');
    if (button && lastInputModality === 'keyboard') openIssuePopover(button);
  });
  document.addEventListener('focusout', (event) => {
    if (!supportsGenuineHover()) return;
    const button = event.target.closest?.('[data-issue-toggle]');
    const popover = event.target.closest?.('.issue-popover');
    const owner = button || (popover ? document.querySelector(`[data-issue-toggle][aria-controls="${popover.id}"]`) : null);
    if (owner) scheduleIssuePopoverClose(owner);
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches?.('[data-view-density]')) {
      setDensity(state, event.target.value);
      showToast(`${event.target.selectedOptions[0]?.textContent || 'Rota'} density selected`);
      return;
    }
    if (event.target.matches?.('[data-compare-week]')) {
      const key = event.target.dataset.compareWeek === 'a' ? 'weekA' : 'weekB';
      state.uiState.comparisonState[key] = Number(event.target.value);
      if (state.uiState.comparisonState.weekA === state.uiState.comparisonState.weekB) {
        state.uiState.comparisonState[key === 'weekA' ? 'weekB' : 'weekA'] = key === 'weekA'
          ? Math.min(state.generatedRotas.latestResult.weeks.length - 1, Number(event.target.value) + 1)
          : Math.max(0, Number(event.target.value) - 1);
      }
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    const conflictAction = event.target.closest?.('[data-conflict-action]');
    if (conflictAction) updateConflictPreview(conflictAction.closest('.chef-selector'));
  });

  requireElement('weekStart').addEventListener('change', (event) => {
    const before = beginDataAction();
    const hadGeneratedRota = !!state.generatedRotas.latestResult;
    const normalized = normalizeWeekStart(event.target.value || getDefaultWeek());
    event.target.value = normalized;
    setWeekStart(normalized);
    state.uiState.selectedResultWeekIndex = 0;
    refreshAll();
    if (hadGeneratedRota) renderResultsPanel();
    finishDataAction('Planning dates changed', before);
  });

  requireElement('mioChef').addEventListener('change', (event) => {
    const before = beginDataAction();
    setMioChef(event.target.value);
    setWeeklyMioChef(state.weeklyInputs.weekStart, event.target.value);
    refreshAll();
    finishDataAction('MIO chef changed', before);
  });

  requireElement('numWeeks').addEventListener('change', (event) => {
    const before = beginDataAction();
    const hadGeneratedRota = !!state.generatedRotas.latestResult;
    setNumWeeks(event.target.value);
    state.uiState.selectedResultWeekIndex = 0;
    refreshAll();
    if (hadGeneratedRota) renderResultsPanel();
    finishDataAction('Rota length changed', before);
  });

  requireElement('addAvailabilityBtn').addEventListener('click', () => {
    const before = beginDataAction();
    addAvailabilityEntry();
    renderAvailabilityTable();
    renderResultsPanel();
    if (state.generatedRotas.latestResult?.status === 'ok') {
      upsertPublishedWeeks(state, state.generatedRotas.latestResult.weeks);
    }
    finishDataAction('Availability entry added', before, 'Availability entry added');
  });

  requireElement('addChefBtn').addEventListener('click', () => openChefEditor({ chefId: null, triggerSelector: '#addChefBtn' }));
  requireElement('cancelChefBtn').addEventListener('click', () => closeChefEditor());
  requireElement('chefForm').addEventListener('submit', handleChefSave);
  requireElement('removeChefBtn').addEventListener('click', () => {
    removeChefConfirmationOpen = true;
    setChefRemovalConfirmation(true, getCurrentChefNameForConfirmation());
    focusSelector('#confirmRemoveChefBtn');
  });
  requireElement('cancelRemoveChefBtn').addEventListener('click', () => hideChefRemovalConfirmation({ restoreFocus: true }));
  requireElement('confirmRemoveChefBtn').addEventListener('click', handleChefRemoval);

  requireElement('addAdditionalChefBtn').addEventListener('click', () => openAdditionalChefModal(null));
  requireElement('cancelAdditionalChefBtn').addEventListener('click', closeAdditionalChefModal);
  requireElement('saveAdditionalChefBtn').addEventListener('click', handleAdditionalChefSave);
  requireElement('cancelManualNoteBtn').addEventListener('click', () => closeManualNoteEditor());
  requireElement('saveManualNoteBtn').addEventListener('click', () => saveManualNote(requireElement('manualNoteText').value, 'Daily note saved'));
  requireElement('removeManualNoteBtn').addEventListener('click', () => saveManualNote('', 'Daily note removed'));
  requireElement('printRotaBtn').addEventListener('click', () => {
    const message = requireElement('printMessage');
    message.textContent = '';
    if (!state.generatedRotas.latestResult) return;
    if (!openPrintWindow(state.generatedRotas.latestResult)) {
      message.textContent = 'Your browser blocked the printable rota. Allow pop-ups for this page, then try again.';
    }
  });
  requireElement('downloadBackupBtn').addEventListener('click', downloadBackup);
  requireElement('restoreBackupBtn').addEventListener('click', () => requireElement('restoreBackupInput').click());
  requireElement('restoreBackupInput').addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    event.target.value = '';
    await restoreBackupFile(file);
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('select[data-weekly-mio-start]')) {
      const weekStart = event.target.getAttribute('data-weekly-mio-start');
      setWeeklyMioChef(weekStart, event.target.value);
      if (weekStart === state.weeklyInputs.weekStart) setMioChef(event.target.value);
      renderResultsPanel();
      persistState();
      return;
    }

    if (event.target.id === 'resultsWeekSelect') {
      state.uiState.selectedResultWeekIndex = Number.parseInt(event.target.value, 10) || 0;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    if (event.target.matches('input[name^="rotaView-"]')) {
      state.uiState.rotaView = event.target.value;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      persistState();
      return;
    }
    if (event.target.matches('[data-rota-day-select]')) {
      state.uiState.selectedDayByWeek[event.target.dataset.weekStart] = event.target.value;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      persistState();
      announce(`${event.target.selectedOptions[0]?.textContent || 'Day'} selected.`);
      return;
    }
    if (event.target.matches('[data-edit-mode]')) {
      state.uiState.editMode = event.target.checked;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }

    if (event.target.matches('input[data-preferred-day-off]')) {
      syncChefChoiceChipState(event.target);
      return;
    }

    if (event.target.classList.contains('entry-chef')) updateAvailabilityField(Number(event.target.dataset.index), 'chef', event.target.value);
    if (event.target.classList.contains('entry-type')) updateAvailabilityField(Number(event.target.dataset.index), 'type', event.target.value);
    if (event.target.classList.contains('entry-start-date')) updateAvailabilityField(Number(event.target.dataset.index), 'startDate', event.target.value);
    if (event.target.classList.contains('entry-finish-date')) updateAvailabilityField(Number(event.target.dataset.index), 'finishDate', event.target.value);
    if (event.target.classList.contains('entry-notes')) updateAvailabilityField(Number(event.target.dataset.index), 'notes', event.target.value);

    if (event.target.classList.contains('entry-chef')
      || event.target.classList.contains('entry-type')
      || event.target.classList.contains('entry-start-date')
      || event.target.classList.contains('entry-finish-date')
      || event.target.classList.contains('entry-notes')) {
      renderResultsPanel();
      const before = fieldHistorySnapshots.get(event.target);
      if (before) {
        recordHistory(state, 'Availability changed', before);
        fieldHistorySnapshots.delete(event.target);
      }
      persistState();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-chef-search]')) { filterChefOptions(event.target.closest('.chef-selector')); return; }
    if (event.target.classList.contains('entry-notes')) {
      updateAvailabilityField(Number(event.target.dataset.index), 'notes', event.target.value);
      renderResultsPanel();
      markUnsaved(state);
    }
  });

  document.addEventListener('scroll', (event) => {
    const wrapper = event.target.closest?.('.rota-table-scroll');
    if (!wrapper) return;
    const max = wrapper.scrollWidth - wrapper.clientWidth;
    wrapper.classList.toggle('has-more-left', wrapper.scrollLeft > 2);
    wrapper.classList.toggle('has-more-right', wrapper.scrollLeft < max - 2);
    wrapper.classList.toggle('is-horizontally-scrolled', wrapper.scrollLeft > 2);
    wrapper.classList.toggle('is-vertically-scrolled', wrapper.scrollTop > 2);
    if (!state.uiState.swipeHintSeen && wrapper.scrollLeft > 8) {
      state.uiState.swipeHintSeen = true;
      wrapper.closest('.results-section')?.querySelector('.rota-swipe-guidance')?.classList.add('hidden');
      persistState();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-toast-dismiss]')) {
      event.target.closest('.app-toast')?.remove();
      return;
    }
    if (event.target.closest('[data-empty-generate]')) {
      generateRota({ forceBestAvailable: state.uiState.readiness?.status === 'blocked' });
      return;
    }
    const contextOpen = event.target.closest('[data-open-context]');
    if (contextOpen) {
      openContextPanel(state, contextOpen.dataset.openContext);
      return;
    }
    if (event.target.closest('[data-context-close]')) {
      if (!closeContextPanel(state)) showToast('Apply or cancel the pending edit first', 'warning');
      return;
    }
    const issueStep = event.target.closest('[data-issue-step]');
    if (issueStep) {
      const issue = navigateIssue(state, issueStep.dataset.issueStep);
      if (issue) {
        renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
        window.requestAnimationFrame(() => emphasizeIssueCell(issue));
      }
      return;
    }
    const issueLink = event.target.closest('[data-navigate-issue]');
    if (issueLink) {
      const issue = navigateIssue(state, issueLink.dataset.navigateIssue);
      closeContextPanel(state, { force: true });
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      window.requestAnimationFrame(() => emphasizeIssueCell(issue));
      return;
    }
    if (event.target.closest('[data-reset-view]')) {
      resetView(state);
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      showToast('View reset');
      return;
    }
    if (event.target.closest('[data-toggle-fullscreen]')) {
      const active = toggleFullScreen(state);
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      showToast(active ? 'Full-screen rota opened' : 'Full-screen rota closed');
      return;
    }
    if (event.target.closest('[data-start-comparison]')) {
      const current = state.uiState.selectedResultWeekIndex || 0;
      state.uiState.comparisonState = {
        active: true,
        weekA: current,
        weekB: current < state.generatedRotas.latestResult.weeks.length - 1 ? current + 1 : current - 1
      };
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    if (event.target.closest('[data-exit-comparison]')) {
      state.uiState.comparisonState.active = false;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    const comparisonFinding = event.target.closest('[data-comparison-finding]');
    if (comparisonFinding) {
      document.querySelectorAll('.comparison-match').forEach((element) => element.classList.remove('comparison-match'));
      document.querySelectorAll(`[data-chef-presence-trigger]`).forEach((element) => {
        if (element.textContent.trim() === comparisonFinding.dataset.comparisonFinding) {
          element.closest('[data-rota-cell]')?.classList.add('comparison-match');
        }
      });
      return;
    }
    const issueToggle = event.target.closest('[data-issue-toggle]');
    if (issueToggle) {
      if (suppressWarningClick) {
        suppressWarningClick = false;
        event.preventDefault();
        return;
      }
      const expanded = issueToggle.getAttribute('aria-expanded') === 'true';
      if (expanded && issueToggle.dataset.issuePinned === 'true') closeIssuePopover(issueToggle);
      else if (expanded) closeIssuePopover(issueToggle);
      else openIssuePopover(issueToggle, { pinned: true });
      return;
    }
    if (event.target.closest('[data-close-mobile-issue]')) {
      closeIssuePopover(null, { restoreFocus: true });
      return;
    }
    const mobileBackdrop = event.target.closest('[data-mobile-issue-sheet]');
    if (mobileBackdrop && event.target === mobileBackdrop) {
      closeIssuePopover(null, { restoreFocus: true });
      return;
    }
    if (event.target.closest('.mobile-issue-sheet')) return;
    if (event.target.closest('.issue-popover')) return;
    closeIssuePopover();

    if (event.target.closest('[data-generate-best-available]')) { generateRota({ forceBestAvailable: true }); return; }
    if (event.target.closest('[data-return-to-setup]')) {
      const setup = requireElement('weekStart');
      setup.focus();
      setup.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      announce('Returned to rota setup.');
      return;
    }

    const modalBackdrop = event.target.closest('#chefModal');
    if (modalBackdrop && event.target.id === 'chefModal' && !removeChefConfirmationOpen) {
      closeChefEditor();
      return;
    }
    const noteModalBackdrop = event.target.closest('#manualNoteModal');
    if (noteModalBackdrop && event.target.id === 'manualNoteModal') {
      closeManualNoteEditor();
      return;
    }

    const openChefButton = event.target.closest('[data-open-chef-id]');
    if (openChefButton) {
      openChefEditor({
        chefId: openChefButton.getAttribute('data-open-chef-id'),
        triggerSelector: `[data-open-chef-id="${openChefButton.getAttribute('data-open-chef-id')}"]`
      });
      return;
    }

    const openCreateButton = event.target.closest('[data-open-chef-create]');
    if (openCreateButton) {
      openChefEditor({ chefId: null, triggerSelector: '[data-open-chef-create="true"]' });
      return;
    }

    const removeAvailability = event.target.closest('button[data-remove]');
    if (removeAvailability) {
      const before = beginDataAction();
      removeAvailabilityEntry(Number(removeAvailability.getAttribute('data-remove')));
      renderAvailabilityTable();
      renderResultsPanel();
      finishDataAction('Availability entry removed', before, 'Availability entry removed');
      return;
    }

    const editDailyNote = event.target.closest('[data-edit-daily-note]');
    if (editDailyNote) {
      openManualNoteEditor(editDailyNote);
      return;
    }

    const editReqBtn = event.target.closest('button[data-edit-req]');
    if (editReqBtn) {
      openAdditionalChefModal(editReqBtn.getAttribute('data-edit-req'));
      return;
    }

    const removeReqBtn = event.target.closest('button[data-remove-req]');
    if (removeReqBtn) {
      const before = beginDataAction();
      removeAdditionalChefRequest(removeReqBtn.getAttribute('data-remove-req'));
      renderAdditionalChefRequirements();
      renderResultsPanel();
      finishDataAction('Additional chef request removed', before, 'Staffing request removed');
      return;
    }

    const resultsTab = event.target.closest('button[data-results-week-index]');
    if (resultsTab) {
      document.querySelector('[data-toolbar-more]')?.setAttribute('aria-expanded', 'false');
      state.uiState.selectedResultWeekIndex = Number.parseInt(resultsTab.getAttribute('data-results-week-index'), 10) || 0;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      saveAppState(state);
      return;
    }
    const dayStep = event.target.closest('[data-day-step]');
    if (dayStep) {
      const select = dayStep.parentElement.querySelector('[data-rota-day-select]');
      const next = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + Number(dayStep.dataset.dayStep)));
      select.selectedIndex = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const statusBar = event.target.closest('[data-open-rota-summary]');
    if (statusBar) {
      const summary = document.getElementById(statusBar.dataset.openRotaSummary);
      if (summary) {
        summary.open = true;
        summary.querySelector('summary')?.focus();
        summary.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }
    if (event.target.closest('[data-close-undo-toast]')) {
      document.querySelector('[data-undo-toast]')?.remove();
      return;
    }
    if (event.target.closest('[data-toggle-edit]')) {
      state.uiState.editMode = !state.uiState.editMode;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    if (event.target.closest('[data-toolbar-print]')) { requireElement('printRotaBtn').click(); return; }
    if (event.target.closest('[data-copy-week]')) { const menu = document.getElementById('toolbarMoreMenu'); if (menu) menu.hidden = true; document.querySelector('[data-toolbar-more]')?.setAttribute('aria-expanded', 'false'); copySelectedWeek(); return; }
    if (event.target.closest('[data-regenerate]')) { generateRota({ forceBestAvailable: true }); return; }
    const moreButton = event.target.closest('[data-toolbar-more]');
    if (moreButton) {
      const menu = document.getElementById('toolbarMoreMenu');
      const opening = moreButton.getAttribute('aria-expanded') !== 'true';
      moreButton.setAttribute('aria-expanded', String(opening)); menu.hidden = !opening;
      if (opening) menu.innerHTML = `<button type="button" data-copy-week>${icon('copy')} Copy week</button><button type="button" data-regenerate>${icon('regenerate')} Generate fresh rota</button><button type="button" data-reset-manual-all ${Object.keys(state.manualEditing?.edits || {}).length ? '' : 'disabled'}>${icon('reset')} Reset manual changes</button>`;
      return;
    }
    if (!event.target.closest('.toolbar-more')) { const menu = document.getElementById('toolbarMoreMenu'); if (menu) menu.hidden = true; document.querySelector('[data-toolbar-more]')?.setAttribute('aria-expanded', 'false'); }
    const filter = event.target.closest('[data-chef-filter]');
    if (filter) {
      const selector = filter.closest('.chef-selector');
      selector.querySelectorAll('[data-chef-filter]').forEach((button) => { const active = button === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      filterChefOptions(selector); return;
    }
    if (event.target.closest('[data-show-all-chefs]')) {
      const selector = event.target.closest('.chef-selector'); selector.querySelector('[data-chef-search]').value = ''; selector.querySelector('[data-chef-filter="all"]').click(); return;
    }
    const setupTarget = event.target.closest('[data-setup-target]');
    if (setupTarget) { const target = document.getElementById(setupTarget.dataset.setupTarget) || document.querySelector(`[data-setup-section="${setupTarget.dataset.setupTarget}"]`); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.focus({ preventScroll: true }); return; }
    if (event.target.closest('[data-toast-undo]')) {
      if (undoManualEdit(state, state.generatedRotas.latestResult)) refreshEditedRota('Manual change undone.');
      document.querySelector('[data-undo-toast]')?.remove();
      return;
    }

    const editAssignment = event.target.closest('[data-edit-assignment]');
    if (editAssignment) {
      state.uiState.selectedCell = {
        weekIndex: Number(editAssignment.dataset.weekIndex),
        date: editAssignment.dataset.date,
        section: editAssignment.dataset.section
      };
      if (state.uiState.editMode) openAssignmentSelector(editAssignment);
      else openContextPanel(state, 'assignment', state.uiState.selectedCell);
      return;
    }
    if (event.target.closest('[data-close-chef-selector]')) { closeChefSelector(); return; }
    const conflictAction = event.target.closest('[data-conflict-action]');
    if (conflictAction) { updateConflictPreview(conflictAction.closest('.chef-selector')); return; }
    const applyConflict = event.target.closest('[data-apply-conflict]');
    if (applyConflict) {
      const before = beginDataAction();
      const selector = applyConflict.closest('.chef-selector');
      const returnFocus = activeAssignmentTrigger;
      const result = applyManualAssignment({
        state,
        overallResult: state.generatedRotas.latestResult,
        weekIndex: Number(selector.dataset.weekIndex),
        date: selector.dataset.date,
        section: selector.dataset.section,
        chef: selector.dataset.conflictChef,
        duplicateAction: selector.querySelector('[data-conflict-action]').value,
        floatAction: 'add'
      });
      const { section, date, conflictChef: chef } = selector.dataset;
      closeChefSelector({ restoreFocus: false });
      if (result.applied) {
        recordHistory(state, result.description || 'Manual assignment changed', before);
        refreshEditedRota(`${result.description}. Validation and totals updated.`);
        showToast('Change applied', 'success');
      }
      else announce(result.reason || 'No change made.');
      returnFocus?.focus();
      return;
    }
    const selectedChef = event.target.closest('[data-select-chef]');
    if (selectedChef) {
      const before = beginDataAction();
      const selector = selectedChef.closest('.chef-selector');
      const weekIndex = Number(selector.dataset.weekIndex);
      const { date, section } = selector.dataset;
      const chef = selectedChef.getAttribute('data-select-chef');
      const floatAction = selectedChef.getAttribute('data-float-action') || 'add';
      const week = state.generatedRotas.latestResult.weeks[weekIndex];
      const duplicate = findDuplicateCoreAssignment(week, date, section, chef);
      if (duplicate) {
        const current = week.rota.find((day) => day.date === date)?.assignments.find((item) => item.section === section)?.chef || '';
        openAssignmentConflict({ selector, weekIndex, date, section, chef, duplicate, current });
        return;
      }
      const result = applyManualAssignment({ state, overallResult: state.generatedRotas.latestResult, weekIndex, date, section, chef, floatAction });
      closeChefSelector({ restoreFocus: false });
      if (result.applied) {
        recordHistory(state, result.description || 'Manual assignment changed', before);
        const actionMessage = section === 'Float'
          ? (floatAction === 'remove' ? `${chef} removed from Float` : (chef ? `${chef} added to Float` : 'Float assignments cleared'))
          : `${section} changed to ${chef || 'None'}`;
        refreshEditedRota(`${actionMessage} on ${date}. Validation and totals updated.`);
        showToast('Change applied', 'success');
      }
      else announce(result.cancelled ? 'Assignment change cancelled.' : result.reason || 'No change made.');
      return;
    }
    if (event.target.closest('[data-global-undo]')) {
      const description = undoDataChange(state);
      if (description) {
        refreshAll();
        persistState();
        showToast(`${description} undone`);
      } else if (undoManualEdit(state, state.generatedRotas.latestResult)) {
        refreshEditedRota('Manual change undone.');
        showToast('Assignment change undone');
      }
      return;
    }
    if (event.target.closest('[data-global-redo]')) {
      const description = redoDataChange(state);
      if (description) {
        refreshAll();
        persistState();
        showToast(`${description} redone`);
      } else if (redoManualEdit(state, state.generatedRotas.latestResult)) {
        refreshEditedRota('Manual change redone.');
        showToast('Assignment change redone');
      }
      return;
    }
    if (event.target.closest('[data-reset-manual-all]')) {
      openResetManualConfirmation(event.target.closest('[data-reset-manual-all]'));
      return;
    }
    if (event.target.closest('[data-confirm-reset-manual]')) {
      const returnFocus = activeAssignmentTrigger;
      const changed = resetAllManualEdits(state, state.generatedRotas.latestResult);
      closeChefSelector({ restoreFocus: false });
      if (changed) refreshEditedRota('All manual changes reset.');
      returnFocus?.focus();
      return;
    }
    if (event.target.closest('[data-reset-manual-cell]')) {
      const selector = event.target.closest('.chef-selector');
      const changed = resetManualCell(state, state.generatedRotas.latestResult, Number(selector.dataset.weekIndex), selector.dataset.date, selector.dataset.section);
      closeChefSelector({ restoreFocus: false });
      if (changed) refreshEditedRota('Cell restored to its originally generated assignment.');
      return;
    }
  });

  document.addEventListener('keydown', (event) => {
    const typing = event.target.matches?.('input,select,textarea,[contenteditable="true"]');
    const command = event.metaKey || event.ctrlKey;
    if (!typing && command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      const description = event.shiftKey ? redoDataChange(state) : undoDataChange(state);
      if (description) {
        refreshAll();
        persistState();
        showToast(`${description} ${event.shiftKey ? 'redone' : 'undone'}`);
      }
      return;
    }
    if (!typing && event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      const description = redoDataChange(state);
      if (description) {
        refreshAll();
        persistState();
        showToast(`${description} redone`);
      }
      return;
    }
    if (!typing && !command && !event.altKey && ['[', ']', 'ArrowLeft', 'ArrowRight'].includes(event.key) && state.generatedRotas.latestResult?.weeks?.length > 1) {
      const direction = ['[', 'ArrowLeft'].includes(event.key) ? -1 : 1;
      const current = state.uiState.selectedResultWeekIndex || 0;
      const next = Math.max(0, Math.min(state.generatedRotas.latestResult.weeks.length - 1, current + direction));
      if (next !== current) {
        event.preventDefault();
        state.uiState.selectedResultWeekIndex = next;
        renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
        saveAppState(state);
      }
      return;
    }
    if (!typing && !command && !event.altKey && ['e', 'E'].includes(event.key) && state.uiState.selectedCell) {
      const selected = state.uiState.selectedCell;
      const assignment = document.querySelector(`[data-edit-assignment][data-week-index="${selected.weekIndex}"][data-date="${selected.date}"][data-section="${CSS.escape(selected.section)}"]`);
      if (assignment) {
        event.preventDefault();
        state.uiState.editMode = true;
        openAssignmentSelector(assignment);
      }
      return;
    }
    if (!typing && !command && !event.altKey && ['u', 'U'].includes(event.key)) {
      const description = undoDataChange(state);
      if (description) {
        event.preventDefault();
        refreshAll();
        persistState();
        showToast(`${description} undone`);
      }
      return;
    }
    const issueButton = event.target.closest?.('[data-issue-toggle]');
    if (issueButton && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (issueButton.getAttribute('aria-expanded') !== 'true') openIssuePopover(issueButton, { pinned: true });
      return;
    }
    const chefCard = event.target.closest?.('[data-open-chef-id]');
    if (chefCard && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      chefCard.click();
      return;
    }

    const chefModal = document.getElementById('chefModal');
    if (chefModal?.classList.contains('open') && event.key === 'Tab') {
      const focusables = getFocusableElements(chefModal);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    if (event.key !== 'Escape') return;
    if (openWarningId) {
      closeIssuePopover(null, { restoreFocus: !!document.querySelector('[data-mobile-issue-sheet]') });
      return;
    }
    const moreMenu = document.getElementById('toolbarMoreMenu');
    if (moreMenu && !moreMenu.hidden) { moreMenu.hidden = true; const button = document.querySelector('[data-toolbar-more]'); button?.setAttribute('aria-expanded', 'false'); button?.focus(); return; }
    if (document.querySelector('.chef-selector')) { closeChefSelector(); return; }
    if (state.uiState.activePanel) {
      if (closeContextPanel(state)) return;
      showToast('Apply or cancel the pending edit first', 'warning');
      return;
    }
    if (state.uiState.fullScreenState) {
      toggleFullScreen(state, false);
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }
    if (document.getElementById('additionalChefModal')?.classList.contains('open')) {
      closeAdditionalChefModal();
      return;
    }
    if (document.getElementById('manualNoteModal')?.classList.contains('open')) {
      closeManualNoteEditor();
      return;
    }
    if (chefModal?.classList.contains('open') && !removeChefConfirmationOpen) {
      closeChefEditor();
    }
  });
}

function publishCurrentWeekIfNeeded() {
  if (!state.generatedRotas.current) return;
  const result = upsertPublishedHistory(state, state.generatedRotas.current.weekStart || state.weeklyInputs.weekStart, state.generatedRotas.current.rota, state.generatedRotas.current.summary);
  if (result.updated || result.inserted) persistState();
}

export function bootstrapApp() {
  loadInitialState();
  ensureCoordinatedUiState(state);
  updateDocumentUiState(state);
  initChefPresence({ getState });
  attachEvents();
  refreshAll();
  publishCurrentWeekIfNeeded();
  if (typeof window !== 'undefined') {
    window.__gtRotaBootstrap = {
      ...(window.__gtRotaBootstrap || {}),
      status: 'ok',
      buildVersion: APP_BUILD_VERSION,
      cacheBustVersion: CACHE_BUST_VERSION
    };
  }
}

try {
  bootstrapApp();
} catch (error) {
  if (typeof window !== 'undefined') {
    window.__gtRotaBootstrap = {
      ...(window.__gtRotaBootstrap || {}),
      status: 'error',
      buildVersion: APP_BUILD_VERSION,
      cacheBustVersion: CACHE_BUST_VERSION,
      message: error.message
    };
  }
  throw error;
}
