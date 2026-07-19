import { APP_BUILD_VERSION, CACHE_BUST_VERSION } from './constants.js?v=20260719s';
import { getState, getDefaultWeek, resetStateToDefaults, syncCompatibilityViews, setWeekStart, setMioChef, setNumWeeks, setWeeklyMioChef } from './state.js';
import { normalizeWeekStart, getPlanningHorizon } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory } from './storage.js?v=20260719s';
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
} from './render.js?v=20260719s';
import { renderChefSelector } from './render.js?v=20260719s';
import { applyManualAssignment, findDuplicateCoreAssignment, redoManualEdit, resetAllManualEdits, resetManualCell, undoManualEdit } from './manual-edit.js';
import { upsertPublishedHistory, upsertPublishedWeeks } from './history.js';
import { openPrintWindow } from './print.js';
import { createBackup, createBackupFilename, restoreBackup, serializeBackup } from './backup.js';

const state = getState();
let editingReqDate = null;
let activeChefId = null;
let activeChefMode = 'create';
let activeChefTriggerSelector = '#addChefBtn';
let removeChefConfirmationOpen = false;
let activeAssignmentTrigger = null;

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`GT Rota Builder is missing required element #${id}. index.html is the canonical entry page.`);
  }
  return element;
}

function persistState() {
  saveAppState(state);
  saveHistory(state.history);
}

function refreshAll() {
  renderAll();
}

function announce(message) {
  const live = document.getElementById('manualEditLive');
  if (live) live.textContent = message;
}

function closeChefSelector({ restoreFocus = true } = {}) {
  document.querySelector('.chef-selector')?.remove();
  document.querySelector('.chef-selector-backdrop')?.remove();
  if (restoreFocus) activeAssignmentTrigger?.focus();
  activeAssignmentTrigger = null;
}

function openAssignmentSelector(button) {
  closeChefSelector({ restoreFocus: false });
  activeAssignmentTrigger = button;
  document.body.insertAdjacentHTML('beforeend', renderChefSelector({
    weekIndex: Number(button.dataset.weekIndex),
    date: button.dataset.date,
    section: button.dataset.section
  }));
  document.querySelector('.chef-selector-option')?.focus();
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
  persistState();
  focusSelector(focusTargetSelector);
}

function handleChefRemoval() {
  if (!activeChefId) return;
  removeChef(activeChefId);
  closeChefEditor({ restoreFocus: false });
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
  persistState();
  focusSelector('#addChefBtn');
}

function openAdditionalChefModal(editDate) {
  const horizon = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  const fmt = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const dateInput = requireElement('additionalChefDate');
  const countInput = requireElement('additionalChefCount');
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
  const dateInput = requireElement('additionalChefDate');
  const countInput = requireElement('additionalChefCount');
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

  if (editingReqDate) {
    updateAdditionalChefRequest(editingReqDate, date, count);
  } else {
    addAdditionalChefRequest(date, count);
  }

  closeAdditionalChefModal();
  renderAdditionalChefRequirements();
  renderResultsPanel();
  persistState();
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
  window.addEventListener('resize', () => updateRotaScrollAccessibility(document));

  requireElement('weekStart').addEventListener('change', (event) => {
    const normalized = normalizeWeekStart(event.target.value || getDefaultWeek());
    event.target.value = normalized;
    setWeekStart(normalized);
    state.uiState.selectedResultWeekIndex = 0;
    refreshAll();
    persistState();
  });

  requireElement('mioChef').addEventListener('change', (event) => {
    setMioChef(event.target.value);
    setWeeklyMioChef(state.weeklyInputs.weekStart, event.target.value);
    refreshAll();
    persistState();
  });

  requireElement('numWeeks').addEventListener('change', (event) => {
    setNumWeeks(event.target.value);
    state.uiState.selectedResultWeekIndex = 0;
    refreshAll();
    persistState();
  });

  requireElement('addAvailabilityBtn').addEventListener('click', () => {
    addAvailabilityEntry();
    renderAvailabilityTable();
    renderResultsPanel();
    if (state.generatedRotas.latestResult?.status === 'ok') {
      upsertPublishedWeeks(state, state.generatedRotas.latestResult.weeks);
    }
    persistState();
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
  requireElement('printRotaBtn').addEventListener('click', () => {
    const message = requireElement('printMessage');
    message.textContent = '';
    if (!state.generatedRotas.latestResult) return;
    if (!openPrintWindow(state.generatedRotas.latestResult)) {
      message.textContent = 'Your browser blocked the printable rota. Allow pop-ups for this page, then try again.';
    }
  });
  requireElement('generateRotaBtn').addEventListener('click', () => {
    const readiness = renderReadinessPanel();
    if (readiness?.status === 'blocked') {
      document.querySelector('[data-generate-best-available]')?.focus();
      announce('Likely rule issues found. Choose Generate best available rota or Return to setup.');
      return;
    }
    renderResultsPanel({ forceBestAvailable: true });
    persistState();
    announce(readiness?.status === 'ready' ? 'Rota generated.' : 'Rota generated with preference warnings.');
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
      persistState();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.classList.contains('entry-notes')) {
      updateAvailabilityField(Number(event.target.dataset.index), 'notes', event.target.value);
      renderResultsPanel();
      persistState();
    }
  });

  document.addEventListener('click', (event) => {
    const issueToggle = event.target.closest('[data-issue-toggle]');
    if (issueToggle) {
      const target = document.getElementById(issueToggle.getAttribute('aria-controls'));
      const expanded = issueToggle.getAttribute('aria-expanded') === 'true';
      document.querySelectorAll('[data-issue-toggle][aria-expanded="true"]').forEach((button) => {
        if (button === issueToggle) return;
        button.setAttribute('aria-expanded', 'false');
        const other = document.getElementById(button.getAttribute('aria-controls'));
        if (other) other.hidden = true;
      });
      issueToggle.setAttribute('aria-expanded', String(!expanded));
      if (target) target.hidden = expanded;
      return;
    }

    if (event.target.closest('[data-generate-best-available]')) {
      renderResultsPanel({ forceBestAvailable: true });
      persistState();
      announce('Best available draft rota generated. Review unresolved rule issues.');
      document.querySelector('#results .status-card')?.focus?.();
      return;
    }

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
      removeAvailabilityEntry(Number(removeAvailability.getAttribute('data-remove')));
      renderAvailabilityTable();
      renderResultsPanel();
      persistState();
      return;
    }

    const editReqBtn = event.target.closest('button[data-edit-req]');
    if (editReqBtn) {
      openAdditionalChefModal(editReqBtn.getAttribute('data-edit-req'));
      return;
    }

    const removeReqBtn = event.target.closest('button[data-remove-req]');
    if (removeReqBtn) {
      removeAdditionalChefRequest(removeReqBtn.getAttribute('data-remove-req'));
      renderAdditionalChefRequirements();
      renderResultsPanel();
      persistState();
      return;
    }

    const resultsTab = event.target.closest('button[data-results-week-index]');
    if (resultsTab) {
      state.uiState.selectedResultWeekIndex = Number.parseInt(resultsTab.getAttribute('data-results-week-index'), 10) || 0;
      renderResultsPanel({ overallResult: state.generatedRotas.latestResult });
      return;
    }

    const editAssignment = event.target.closest('[data-edit-assignment]');
    if (editAssignment) { openAssignmentSelector(editAssignment); return; }
    if (event.target.closest('[data-close-chef-selector]')) { closeChefSelector(); return; }
    const selectedChef = event.target.closest('[data-select-chef]');
    if (selectedChef) {
      const selector = selectedChef.closest('.chef-selector');
      const weekIndex = Number(selector.dataset.weekIndex);
      const { date, section } = selector.dataset;
      const chef = selectedChef.getAttribute('data-select-chef');
      const floatAction = selectedChef.getAttribute('data-float-action') || 'add';
      const week = state.generatedRotas.latestResult.weeks[weekIndex];
      const duplicate = findDuplicateCoreAssignment(week, date, section, chef);
      let duplicateAction = '';
      if (duplicate) {
        const current = week.rota.find((day) => day.date === date)?.assignments.find((item) => item.section === section)?.chef || '';
        const choice = window.prompt(section !== 'Float' && current
          ? `${chef} already covers ${duplicate.section}. Type SWAP, MOVE, or CANCEL.`
          : `${chef} already covers ${duplicate.section}. Type MOVE or CANCEL.`, 'CANCEL');
        const normalized = String(choice || 'cancel').trim().toLowerCase();
        if (normalized === 'swap' && current && section !== 'Float') duplicateAction = 'swap';
        else if (normalized === 'move') duplicateAction = 'move';
        else duplicateAction = 'cancel';
      }
      const result = applyManualAssignment({ state, overallResult: state.generatedRotas.latestResult, weekIndex, date, section, chef, duplicateAction, floatAction });
      closeChefSelector({ restoreFocus: false });
      if (result.applied) {
        const actionMessage = section === 'Float'
          ? (floatAction === 'remove' ? `${chef} removed from Float` : (chef ? `${chef} added to Float` : 'Float assignments cleared'))
          : `${section} changed to ${chef || 'None'}`;
        refreshEditedRota(`${actionMessage} on ${date}. Validation and totals updated.`);
      }
      else announce(result.cancelled ? 'Assignment change cancelled.' : result.reason || 'No change made.');
      return;
    }
    if (event.target.closest('[data-manual-undo]')) { if (undoManualEdit(state, state.generatedRotas.latestResult)) refreshEditedRota('Manual change undone.'); return; }
    if (event.target.closest('[data-manual-redo]')) { if (redoManualEdit(state, state.generatedRotas.latestResult)) refreshEditedRota('Manual change redone.'); return; }
    if (event.target.closest('[data-reset-manual-all]')) {
      if (window.confirm('Reset all manual assignment changes?') && resetAllManualEdits(state, state.generatedRotas.latestResult)) refreshEditedRota('All manual changes reset.');
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
    if (document.querySelector('.chef-selector')) { closeChefSelector(); return; }
    if (document.getElementById('additionalChefModal')?.classList.contains('open')) {
      closeAdditionalChefModal();
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
