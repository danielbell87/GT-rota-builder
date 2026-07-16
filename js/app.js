import { CHEF_ROLES } from './constants.js';
import { getState, getDefaultWeek, syncCompatibilityViews, setWeekStart, setMioChef, setNumWeeks } from './state.js';
import { getPlanningHorizon, normalizeWeekStart, parseLocalDate } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory, persistAllMioEligibility, persistAllStaffProfiles, persistMioEligibilityForChef, renamePersistedMioEligibility, renamePersistedStaffProfile } from './storage.js?v=20260714';
import { addChef, createChefFromModalDom, updateChefField, updateChefSkill, removeChef } from './staff.js';
import { addAvailabilityEntry, removeAvailabilityEntry, updateAvailabilityField, addAdditionalChefRequest, updateAdditionalChefRequest, removeAdditionalChefRequest, validateAdditionalChefDateForHorizon, validateAdditionalChefCount } from './weekly-inputs.js';
import { renderAll, renderResultsPanel, renderAdditionalChefRequirements, renderAvailabilityTable, renderStaffTable } from './render.js';
import { upsertPublishedHistory } from './history.js';

const state = getState();

function persistState() {
  saveAppState(state);
  saveHistory(state.history);
}

function getElement(id) {
  return document.getElementById(id);
}

function bindIfPresent(id, eventName, handler) {
  const element = getElement(id);
  if (element) element.addEventListener(eventName, handler);
}

export function openAddChefModal() {
  const modal = getElement('chefModal');
  const nameInput = getElement('newChefName');
  const roleSelect = getElement('newChefRole');
  const mioSelect = getElement('newChefMio');
  const weekendSelect = getElement('newChefWeekendRule');
  const fixedDaySelect = getElement('newChefFixedDayOff');
  if (!modal || !nameInput || !roleSelect || !mioSelect || !weekendSelect || !fixedDaySelect) return;

  nameInput.value = '';
  roleSelect.innerHTML = CHEF_ROLES.map((role) => `<option>${role}</option>`).join('');
  mioSelect.value = 'true';
  weekendSelect.value = '';
  fixedDaySelect.value = '';
  document.querySelectorAll('.new-skill-select').forEach((select) => { select.value = '0'; });
  modal.classList.add('open');
}

export function closeAddChefModal() {
  getElement('chefModal')?.classList.remove('open');
}

function loadInitialState() {
  migrateStorageIfNeeded();
  loadAppState();
  state.history = loadHistory();
  syncCompatibilityViews();

  if (!state.weeklyInputs.weekStart) {
    state.weeklyInputs.weekStart = normalizeWeekStart(getDefaultWeek());
  }

  const weekStartInput = getElement('weekStart');
  if (weekStartInput) weekStartInput.value = normalizeWeekStart(state.weeklyInputs.weekStart || getDefaultWeek());
  renderStaffTable();
  const mioChefSelect = getElement('mioChef');
  if (mioChefSelect) mioChefSelect.value = state.weeklyInputs.mioChef || '';
  const numWeeksEl = getElement('numWeeks');
  if (numWeeksEl) numWeeksEl.value = String(state.weeklyInputs.numWeeks || 1);
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

let editingRequirementDate = null;

function openAdditionalChefModal(editDate) {
  const { startDate, endDate } = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const rangeEl = getElement('additionalChefWeekRange');
  const dateInput = getElement('additionalChefDate');
  const countInput = getElement('additionalChefCount');
  const errorEl = getElement('additionalChefError');
  const titleEl = getElement('additionalChefModalTitle');
  const saveBtn = getElement('saveAdditionalChefBtn');
  const modal = getElement('additionalChefModal');
  if (!rangeEl || !dateInput || !countInput || !errorEl || !titleEl || !saveBtn || !modal) return;

  const fmt = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  rangeEl.textContent = `Valid dates: ${fmt(start)} – ${fmt(end)}`;
  dateInput.min = startDate;
  dateInput.max = endDate;
  errorEl.textContent = '';

  if (editDate) {
    editingRequirementDate = editDate;
    const request = (state.weeklyInputs.additionalChefRequirements || []).find((item) => item.date === editDate);
    dateInput.value = editDate;
    countInput.value = request ? request.count : 1;
    titleEl.textContent = 'Edit additional chef';
    saveBtn.textContent = 'Save';
  } else {
    editingRequirementDate = null;
    const existingDates = new Set((state.weeklyInputs.additionalChefRequirements || []).map((item) => item.date));
    let defaultDate = startDate;
    const spanDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
    for (let index = 0; index <= spanDays; index += 1) {
      const nextDate = new Date(start);
      nextDate.setDate(start.getDate() + index);
      const candidate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
      if (!existingDates.has(candidate)) {
        defaultDate = candidate;
        break;
      }
    }
    dateInput.value = defaultDate;
    countInput.value = 1;
    titleEl.textContent = 'Add additional chef';
    saveBtn.textContent = 'Add';
  }

  modal.classList.add('open');
  dateInput.focus();
}

function closeAdditionalChefModal() {
  getElement('additionalChefModal')?.classList.remove('open');
  getElement('addAdditionalChefBtn')?.focus();
  editingRequirementDate = null;
}

function handleAdditionalChefSave() {
  const dateInput = getElement('additionalChefDate');
  const countInput = getElement('additionalChefCount');
  const errorEl = getElement('additionalChefError');
  if (!dateInput || !countInput || !errorEl) return;

  const dateError = validateAdditionalChefDateForHorizon(dateInput.value, state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  if (dateError) {
    errorEl.textContent = dateError;
    dateInput.focus();
    return;
  }

  const countError = validateAdditionalChefCount(countInput.value);
  if (countError) {
    errorEl.textContent = countError;
    countInput.focus();
    return;
  }

  const count = parseInt(countInput.value, 10);
  const date = dateInput.value;
  if (editingRequirementDate) {
    updateAdditionalChefRequest(editingRequirementDate, date, count);
  } else {
    addAdditionalChefRequest(date, count);
  }

  closeAdditionalChefModal();
  renderAdditionalChefRequirements();
  renderResultsPanel();
  persistState();
}

function attachEvents() {
  bindIfPresent('weekStart', 'change', (event) => {
    const normalized = normalizeWeekStart(event.target.value || getDefaultWeek());
    event.target.value = normalized;
    setWeekStart(normalized);
    state.uiState.activeWeekIndex = 0;
    renderResultsPanel();
    persistState();
  });

  bindIfPresent('mioChef', 'change', (event) => {
    setMioChef(event.target.value);
    renderResultsPanel();
    persistState();
  });

  bindIfPresent('numWeeks', 'change', (event) => {
    setNumWeeks(event.target.value);
    state.uiState.activeWeekIndex = 0;
    renderStaffTable();
    renderAvailabilityTable();
    renderResultsPanel();
    persistState();
  });

  bindIfPresent('addAvailabilityBtn', 'click', () => {
    addAvailabilityEntry();
    renderAvailabilityTable();
    renderResultsPanel();
    persistState();
  });

  bindIfPresent('addChefBtn', 'click', openAddChefModal);
  bindIfPresent('cancelChefBtn', 'click', closeAddChefModal);
  bindIfPresent('saveChefBtn', 'click', handleChefAdd);

  bindIfPresent('addAdditionalChefBtn', 'click', () => openAdditionalChefModal(null));
  bindIfPresent('cancelAdditionalChefBtn', 'click', closeAdditionalChefModal);
  bindIfPresent('saveAdditionalChefBtn', 'click', handleAdditionalChefSave);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (getElement('additionalChefModal')?.classList.contains('open')) {
      closeAdditionalChefModal();
      return;
    }
    if (getElement('chefModal')?.classList.contains('open')) {
      closeAddChefModal();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.classList?.contains('weekly-mio-select')) {
      state.uiState.activeWeekIndex = 0;
      renderResultsPanel();
      persistState();
      return;
    }
    if (event.target.id === 'mobileWeekSelect') {
      state.uiState.activeWeekIndex = Number(event.target.value) || 0;
      renderResultsPanel();
      persistState();
      return;
    }

    updateStateFromControl(event);
    const isControl = event.target.dataset.field
      || event.target.dataset.skill
      || event.target.classList.contains('entry-chef')
      || event.target.classList.contains('entry-type')
      || event.target.classList.contains('entry-start-date')
      || event.target.classList.contains('entry-finish-date')
      || event.target.classList.contains('entry-notes');
    if (!isControl) return;
    renderStaffTable();
    renderResultsPanel();
    persistState();
  });

  document.addEventListener('input', (event) => {
    updateStateFromControl(event);
    const isControl = event.target.dataset.field
      || event.target.dataset.skill
      || event.target.classList.contains('entry-chef')
      || event.target.classList.contains('entry-type')
      || event.target.classList.contains('entry-start-date')
      || event.target.classList.contains('entry-finish-date')
      || event.target.classList.contains('entry-notes');
    if (!isControl) return;
    renderResultsPanel();
    persistState();
  });

  document.addEventListener('click', (event) => {
    const weekTabButton = event.target.closest('button[data-week-tab]');
    if (weekTabButton) {
      state.uiState.activeWeekIndex = Number(weekTabButton.getAttribute('data-week-tab')) || 0;
      renderResultsPanel();
      persistState();
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

    const removeChefButton = event.target.closest('button[data-remove-chef]');
    if (removeChefButton) {
      removeChef(Number(removeChefButton.getAttribute('data-remove-chef')));
      persistAllStaffProfiles();
      persistAllMioEligibility();
      renderStaffTable();
      renderAvailabilityTable();
      renderResultsPanel();
      persistState();
      return;
    }

    const editReqButton = event.target.closest('button[data-edit-req]');
    if (editReqButton) {
      openAdditionalChefModal(editReqButton.getAttribute('data-edit-req'));
      return;
    }

    const removeReqButton = event.target.closest('button[data-remove-req]');
    if (removeReqButton) {
      removeAdditionalChefRequest(removeReqButton.getAttribute('data-remove-req'));
      renderAdditionalChefRequirements();
      renderResultsPanel();
      persistState();
    }
  });
}

function publishGeneratedWeeksIfNeeded() {
  const generatedWeeks = state.generatedRotas.lastBuild?.weeks || [];
  if (!generatedWeeks.length) return;
  let changed = false;
  generatedWeeks.forEach((week) => {
    const result = upsertPublishedHistory(state, {
      weekStart: week.weekStart,
      mioChef: week.mioChef,
      rota: week.rota,
      summary: week.summary,
      validation: {
        hard: week.hardValidation || [],
        messages: week.validation || []
      },
      fairnessSummary: week.fairnessSummary || [],
      status: week.status
    });
    if (result.updated || result.inserted) changed = true;
  });
  if (changed) persistState();
}

export function bootstrapApp() {
  try {
    loadInitialState();
    attachEvents();
    renderAll();
    publishGeneratedWeeksIfNeeded();
    window.__gtRotaBootstrap = { ok: true };
  } catch (error) {
    window.__gtRotaBootstrap = { ok: false, message: error?.message || String(error) };
    throw error;
  }
}

bootstrapApp();
