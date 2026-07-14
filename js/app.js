import { CHEF_ROLES } from './constants.js';
import { getState, getDefaultWeek, resetStateToDefaults, syncCompatibilityViews, setWeekStart, setMioChef, setRuleChanges } from './state.js';
import { normalizeWeekStart } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory, persistAllMioEligibility, persistAllStaffProfiles, persistMioEligibilityForChef, renamePersistedMioEligibility, renamePersistedStaffProfile } from './storage.js?v=20260714';
import { addChef, createChefFromModalDom, updateChefField, updateChefSkill, removeChef, resetStaffToDefaults } from './staff.js';
import { addAvailabilityEntry, removeAvailabilityEntry, updateAvailabilityField, updateDailyOverrideFromRow } from './weekly-inputs.js';
import { renderAll, renderResultsPanel, renderDailyOverrides, renderAvailabilityTable, renderStaffTable, openAddChefModal, closeAddChefModal, renderRuleSummary } from './render.js';
import { upsertPublishedHistory } from './history.js';

const state = getState();

function persistState() {
  saveAppState(state);
  saveHistory(state.history);
}

function loadInitialState() {
  migrateStorageIfNeeded();
  loadAppState();
  state.history = loadHistory();
  syncCompatibilityViews();

  if (!state.weeklyInputs.weekStart) {
    state.weeklyInputs.weekStart = normalizeWeekStart(getDefaultWeek());
  }

  document.getElementById('weekStart').value = normalizeWeekStart(state.weeklyInputs.weekStart || getDefaultWeek());
  document.getElementById('changes').value = state.weeklyInputs.changes || '';
  renderStaffTable();
  document.getElementById('mioChef').value = state.weeklyInputs.mioChef || '';
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

function attachEvents() {
  document.getElementById('weekStart').addEventListener('change', (event) => {
    const normalized = normalizeWeekStart(event.target.value || getDefaultWeek());
    event.target.value = normalized;
    setWeekStart(normalized);
    renderResultsPanel();
    persistState();
  });

  document.getElementById('changes').addEventListener('input', (event) => {
    setRuleChanges(event.target.value);
    renderRuleSummary();
    renderResultsPanel();
    persistState();
  });

  document.getElementById('mioChef').addEventListener('change', (event) => {
    setMioChef(event.target.value);
    renderResultsPanel();
    persistState();
  });

  document.getElementById('addAvailabilityBtn').addEventListener('click', () => {
    addAvailabilityEntry();
    renderAvailabilityTable();
    renderResultsPanel();
    persistState();
  });

  document.getElementById('addChefBtn').addEventListener('click', openAddChefModal);
  document.getElementById('cancelChefBtn').addEventListener('click', closeAddChefModal);
  document.getElementById('saveChefBtn').addEventListener('click', handleChefAdd);

  document.addEventListener('change', (event) => {
    if (event.target.dataset.eventName !== undefined || event.target.dataset.extraChefs !== undefined) {
      const row = event.target.closest('[data-day]');
      if (row) {
        updateDailyOverrideFromRow(row);
        renderDailyOverrides();
        renderResultsPanel();
        persistState();
      }
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
  });
}

function publishCurrentWeekIfNeeded() {
  if (!state.generatedRotas.current) return;
  const result = upsertPublishedHistory(state, state.weeklyInputs.weekStart, state.generatedRotas.current.rota, state.generatedRotas.current.summary);
  if (result.updated || result.inserted) persistState();
}

export function bootstrapApp() {
  loadInitialState();
  attachEvents();
  renderAll();
  publishCurrentWeekIfNeeded();
}

bootstrapApp();
