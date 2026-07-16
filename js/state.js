import { DEFAULT_STAFF } from '../data/default-staff.js';
import { DEFAULT_RULES } from '../data/default-rules.js';

const today = new Date();
const defaultWeek = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const initialState = {
  staff: JSON.parse(JSON.stringify(DEFAULT_STAFF)),
  settings: {
    rules: JSON.parse(JSON.stringify(DEFAULT_RULES))
  },
  weeklyInputs: {
    weekStart: defaultWeek,
    mioChef: '',
    status: 'Draft',
    dailyOverrides: {},
    availability: [],
    additionalChefRequirements: []
  },
  generatedRotas: {
    current: null
  },
  history: [],
  uiState: {
    validation: [],
    softScore: null,
    lastError: ''
  },
  availability: [],
  dailyOverrides: {}
};

const appState = JSON.parse(JSON.stringify(initialState));

export function getState() {
  return appState;
}

export function getDefaultWeek() {
  return defaultWeek;
}

export function resetStateToDefaults() {
  const fresh = JSON.parse(JSON.stringify(initialState));
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

export function setAdditionalChefRequirements(entries) {
  appState.weeklyInputs.additionalChefRequirements = entries;
  syncCompatibilityViews();
}
