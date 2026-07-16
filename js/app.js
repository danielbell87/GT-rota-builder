import { CHEF_ROLES, APP_BUILD_VERSION, CACHE_BUST_VERSION } from './constants.js';
import { getState, getDefaultWeek, syncCompatibilityViews, setWeekStart, setMioChef, setNumWeeks, setWeeklyMioChef } from './state.js';
import { normalizeWeekStart, getPlanningHorizon } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory, persistAllMioEligibility, persistAllStaffProfiles, persistMioEligibilityForChef, renamePersistedMioEligibility, renamePersistedStaffProfile } from './storage.js?v=20260716b';
import { addChef, createChefFromModalDom, updateChefField, updateChefSkill, removeChef } from './staff.js';
import { addAvailabilityEntry, removeAvailabilityEntry, updateAvailabilityField, addAdditionalChefRequest, updateAdditionalChefRequest, removeAdditionalChefRequest, validateAdditionalChefDate, validateAdditionalChefCount } from './weekly-inputs.js';
import { renderAll, renderResultsPanel, renderAdditionalChefRequirements, renderAvailabilityTable, renderStaffTable, openAddChefModal, closeAddChefModal } from './render.js';
import { upsertPublishedHistory } from './history.js';

const state = getState();

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

function handleChefAdd() {
  const chef = createChefFromModalDom();
  if (!chef.role) chef.role = CHEF_ROLES[0];
  const result = addChef(chef);
  if (!result.valid) return;
  closeAddChefModal();
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
  persistAllStaffProfiles();
  persistAllMioEligibility();
  persistState();
}

function updateStateFromControl(event) {
  if (event.target.classList.contains('entry-chef')) {
    updateAvailabilityField(Number(event.target.dataset.index), 'chef', event.target.value);
  }
  if (event.target.classList.contains('entry-type')) {
    updateAvailabilityField(Number(event.target.dataset.index), 'type', event.target.value);
  }
  if (event.target.classList.contains('entry-start-date')) {
    updateAvailabilityField(Number(event.target.dataset.index), 'startDate', event.target.value);
  }
  if (event.target.classList.contains('entry-finish-date')) {
    updateAvailabilityField(Number(event.target.dataset.index), 'finishDate', event.target.value);
  }
  if (event.target.classList.contains('entry-notes')) {
    updateAvailabilityField(Number(event.target.dataset.index), 'notes', event.target.value);
  }

  if (event.target.dataset.field === 'name') {
    const index = Number(event.target.dataset.index);
    const oldName = state.staff[index].name;
    updateChefField(index, 'name', event.target.value);
    renamePersistedStaffProfile(oldName, state.staff[index].name);
    renamePersistedMioEligibility(oldName, state.staff[index].name);
  }
  if (event.target.dataset.field === 'role') {
    updateChefField(Number(event.target.dataset.index), 'role', event.target.value);
  }
  if (event.target.dataset.field === 'mio') {
    const index = Number(event.target.dataset.index);
    updateChefField(index, 'mioEligible', event.target.value === 'true');
    const chef = state.staff[index];
    persistMioEligibilityForChef(chef?.name, chef?.mioEligible);
  }
  if (event.target.dataset.field === 'weekend') {
    updateChefField(Number(event.target.dataset.index), 'weekendRule', event.target.value);
  }
  if (event.target.dataset.field === 'fixedDay') {
    updateChefField(Number(event.target.dataset.index), 'fixedDayOff', event.target.value);
  }
  if (event.target.dataset.skill) {
    updateChefSkill(Number(event.target.dataset.index), event.target.dataset.skill, event.target.value);
  }

  if (event.target.dataset.field || event.target.dataset.skill) {
    persistAllStaffProfiles();
    persistAllMioEligibility();
  }
}

let editingReqDate = null;

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
  if (dateErr) { errorEl.textContent = dateErr; dateInput.focus(); return; }

  const countErr = validateAdditionalChefCount(countInput.value);
  if (countErr) { errorEl.textContent = countErr; countInput.focus(); return; }

  const count = Number.parseInt(countInput.value, 10);
  if (!Number.isInteger(count) || count < 1) {
    errorEl.textContent = 'Please enter a valid quantity.';
    countInput.focus();
    return;
  }
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

function attachEvents() {
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
    persistState();
  });

  requireElement('addChefBtn').addEventListener('click', openAddChefModal);
  requireElement('cancelChefBtn').addEventListener('click', closeAddChefModal);
  requireElement('saveChefBtn').addEventListener('click', handleChefAdd);

  requireElement('addAdditionalChefBtn').addEventListener('click', () => openAdditionalChefModal(null));
  requireElement('cancelAdditionalChefBtn').addEventListener('click', closeAdditionalChefModal);
  requireElement('saveAdditionalChefBtn').addEventListener('click', handleAdditionalChefSave);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('additionalChefModal')?.classList.contains('open')) {
      closeAdditionalChefModal();
    } else if (document.getElementById('chefModal')?.classList.contains('open')) {
      closeAddChefModal();
    }
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
      renderResultsPanel();
      return;
    }

    updateStateFromControl(event);
    const isControl = event.target.dataset.field || event.target.dataset.skill || event.target.classList.contains('entry-chef') || event.target.classList.contains('entry-type') || event.target.classList.contains('entry-start-date') || event.target.classList.contains('entry-finish-date') || event.target.classList.contains('entry-notes');
    if (isControl) {
      renderStaffTable();
      renderResultsPanel();
      persistState();
    }
  });

  document.addEventListener('input', (event) => {
    updateStateFromControl(event);
    const isControl = event.target.dataset.field || event.target.dataset.skill || event.target.classList.contains('entry-chef') || event.target.classList.contains('entry-type') || event.target.classList.contains('entry-start-date') || event.target.classList.contains('entry-finish-date') || event.target.classList.contains('entry-notes');
    if (isControl) {
      renderResultsPanel();
      persistState();
    }
  });

  document.addEventListener('click', (event) => {
    const removeAvailability = event.target.closest('button[data-remove]');
    if (removeAvailability) {
      removeAvailabilityEntry(Number(removeAvailability.getAttribute('data-remove')));
      renderAvailabilityTable();
      renderResultsPanel();
      persistState();
    }

    const removeChefButton = event.target.closest('button[data-remove-chef]');
    if (removeChefButton) {
      removeChef(Number(removeChefButton.getAttribute('data-remove-chef')));
      persistAllStaffProfiles();
      persistAllMioEligibility();
      renderStaffTable();
      renderAvailabilityTable();
      renderResultsPanel();
      persistState();
    }

    const editReqBtn = event.target.closest('button[data-edit-req]');
    if (editReqBtn) {
      openAdditionalChefModal(editReqBtn.getAttribute('data-edit-req'));
    }

    const removeReqBtn = event.target.closest('button[data-remove-req]');
    if (removeReqBtn) {
      removeAdditionalChefRequest(removeReqBtn.getAttribute('data-remove-req'));
      renderAdditionalChefRequirements();
      renderResultsPanel();
      persistState();
    }

    const resultsTab = event.target.closest('button[data-results-week-index]');
    if (resultsTab) {
      state.uiState.selectedResultWeekIndex = Number.parseInt(resultsTab.getAttribute('data-results-week-index'), 10) || 0;
      renderResultsPanel();
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
