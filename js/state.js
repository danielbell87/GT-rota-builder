import { DEFAULT_STAFF } from '../data/default-staff.js';
import { DEFAULT_RULES } from '../data/default-rules.js';

const today = new Date();
const defaultWeek = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function buildDefaultWeeklyInputs() {
  return {
    weekStart: defaultWeek,
    numWeeks: 1,
    mioChef: '',
    weeklyMioSelections: {},
    status: 'Draft',
    dailyOverrides: {},
    availability: [],
    additionalChefRequirements: []
  };
}

function buildInitialState() {
  return {
    staff: JSON.parse(JSON.stringify(DEFAULT_STAFF)),
    settings: {
      rules: JSON.parse(JSON.stringify(DEFAULT_RULES))
    },
    weeklyInputs: buildDefaultWeeklyInputs(),
    generatedRotas: {
      current: null,
      latestResult: null
    },
    history: [],
    manualEditing: null,
    uiState: {
      validation: [],
      softValidation: [],
      validationByWeek: [],
      softScore: null,
      lastError: '',
      selectedResultWeekIndex: 0
    },
    availability: [],
    dailyOverrides: {}
  };
}

const initialState = buildInitialState();
const appState = JSON.parse(JSON.stringify(initialState));

export function getState() {
  return appState;
}

export function getDefaultWeek() {
  return defaultWeek;
}

export function resetStateToDefaults() {
  const fresh = buildInitialState();
  Object.keys(appState).forEach((key) => {
    delete appState[key];
  });
  Object.assign(appState, fresh);
}

export function syncCompatibilityViews() {
  appState.availability = appState.weeklyInputs.availability;
  appState.dailyOverrides = appState.weeklyInputs.dailyOverrides;
}

export function setWeekStart(weekStart) {
  appState.weeklyInputs.weekStart = weekStart;
}

export function setMioChef(name) {
  appState.weeklyInputs.mioChef = name;
}

export function setWeeklyMioChef(weekStart, chefName) {
  if (!weekStart) return;
  if (!appState.weeklyInputs.weeklyMioSelections || typeof appState.weeklyInputs.weeklyMioSelections !== 'object') {
    appState.weeklyInputs.weeklyMioSelections = {};
  }
  appState.weeklyInputs.weeklyMioSelections[weekStart] = chefName || '';
  if (weekStart === appState.weeklyInputs.weekStart) {
    appState.weeklyInputs.mioChef = chefName || '';
  }
}

export function setStatus(status) {
  appState.weeklyInputs.status = status;
}

export function setAvailability(entries) {
  appState.weeklyInputs.availability = entries;
  syncCompatibilityViews();
}

export function setDailyOverrides(overrides) {
  appState.weeklyInputs.dailyOverrides = overrides;
  syncCompatibilityViews();
}

export function setNumWeeks(value) {
  const parsed = Number.parseInt(value, 10);
  appState.weeklyInputs.numWeeks = Math.max(1, Math.min(8, parsed || 1));
}

export function setAdditionalChefRequirements(entries) {
  appState.weeklyInputs.additionalChefRequirements = entries;
  syncCompatibilityViews();
}
