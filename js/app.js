import { CHEF_ROLES } from './constants.js';
import { getState, getDefaultWeek, resetStateToDefaults, syncCompatibilityViews, setWeekStart, setMioChef } from './state.js';
import { normalizeWeekStart } from './utils.js';
import { migrateStorageIfNeeded, loadAppState, saveAppState, saveHistory, loadHistory, persistAllMioEligibility, persistAllStaffProfiles, persistMioEligibilityForChef, renamePersistedMioEligibility, renamePersistedStaffProfile } from './storage.js?v=20260714';
import { addChef, createChefFromModalDom, updateChefField, updateChefSkill, removeChef, resetStaffToDefaults } from './staff.js';
import { addAvailabilityEntry, removeAvailabilityEntry, updateAvailabilityField, addAdditionalChefRequest, updateAdditionalChefRequest, removeAdditionalChefRequest, validateAdditionalChefDate, validateAdditionalChefCount } from './weekly-inputs.js';
import { renderAll, renderResultsPanel, renderAdditionalChefRequirements, renderAvailabilityTable, renderStaffTable, openAddChefModal, closeAddChefModal } from './render.js';
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

// Track whether the additional-chef modal is in edit mode and which date is being edited
let _editingReqDate = null;

function openAdditionalChefModal(editDate) {
  const state = getState();
  const weekStart = state.weeklyInputs.weekStart;
  // Build week date range for label and date constraints
  const parts = weekStart.split('-').map(Number);
  const monday = new Date(parts[0], parts[1] - 1, parts[2]);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const minDate = weekStart;
  const maxDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;

  document.getElementById('additionalChefWeekRange').textContent = `Valid dates: ${fmt(monday)} – ${fmt(sunday)}`;
  const dateInput = document.getElementById('additionalChefDate');
  dateInput.min = minDate;
  dateInput.max = maxDate;

  const countInput = document.getElementById('additionalChefCount');
  document.getElementById('additionalChefError').textContent = '';

  const titleEl = document.getElementById('additionalChefModalTitle');
  const saveBtn = document.getElementById('saveAdditionalChefBtn');

  if (editDate) {
    // Edit mode
    _editingReqDate = editDate;
    const req = (state.weeklyInputs.additionalChefRequirements || []).find((r) => r.date === editDate);
    dateInput.value = editDate;
    countInput.value = req ? req.count : 1;
    titleEl.textContent = 'Edit additional chef';
    saveBtn.textContent = 'Save';
  } else {
    // Add mode – default to first week date without an existing request
    _editingReqDate = null;
    const existing = new Set((state.weeklyInputs.additionalChefRequirements || []).map((r) => r.date));
    let defaultDate = weekStart;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!existing.has(ds)) { defaultDate = ds; break; }
    }
    dateInput.value = defaultDate;
    countInput.value = 1;
    titleEl.textContent = 'Add additional chef';
    saveBtn.textContent = 'Add';
  }

  document.getElementById('additionalChefModal').classList.add('open');
  dateInput.focus();
}

function closeAdditionalChefModal() {
  document.getElementById('additionalChefModal').classList.remove('open');
  document.getElementById('addAdditionalChefBtn').focus();
  _editingReqDate = null;
}

function handleAdditionalChefSave() {
  const state = getState();
  const dateInput = document.getElementById('additionalChefDate');
  const countInput = document.getElementById('additionalChefCount');
  const errorEl = document.getElementById('additionalChefError');

  const dateErr = validateAdditionalChefDate(dateInput.value, state.weeklyInputs.weekStart);
  if (dateErr) { errorEl.textContent = dateErr; dateInput.focus(); return; }

  const countErr = validateAdditionalChefCount(countInput.value);
  if (countErr) { errorEl.textContent = countErr; countInput.focus(); return; }

  const count = parseInt(countInput.value, 10);
  const date = dateInput.value;

  if (_editingReqDate) {
    updateAdditionalChefRequest(_editingReqDate, date, count);
  } else {
    addAdditionalChefRequest(date, count);
  }

  closeAdditionalChefModal();
  renderAdditionalChefRequirements();
  renderResultsPanel();
  persistState();
}

function attachEvents() {
  document.getElementById('weekStart').addEventListener('change', (event) => {
    const normalized = normalizeWeekStart(event.target.value || getDefaultWeek());
    event.target.value = normalized;
    setWeekStart(normalized);
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

  document.getElementById('addAdditionalChefBtn').addEventListener('click', () => openAdditionalChefModal(null));
  document.getElementById('cancelAdditionalChefBtn').addEventListener('click', closeAdditionalChefModal);
  document.getElementById('saveAdditionalChefBtn').addEventListener('click', handleAdditionalChefSave);

  // Close modals on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.getElementById('additionalChefModal').classList.contains('open')) {
        closeAdditionalChefModal();
      } else if (document.getElementById('chefModal').classList.contains('open')) {
        closeAddChefModal();
      }
    }
  });

  document.addEventListener('change', (event) => {
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
