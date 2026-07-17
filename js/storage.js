import { getState, syncCompatibilityViews } from './state.js';
import { normalizeStaffRecords } from './staff.js';
import { normalizeWeekStart } from './utils.js';

export const STORAGE_KEYS = {
  schemaVersion: 'gtRota.schemaVersion',
  appState: 'gtRota.state.v2',
  history: 'gtRota.history.v1',
  mioEligibilityByChef: 'gtRota.mioEligibilityByChef',
  staffProfilesByChef: 'gtRota.staffProfilesByChef'
};

const CURRENT_SCHEMA_VERSION = 5;

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeWeeklyInputsShape(weeklyInputs = {}, fallbackWeekStart = '') {
  const normalizedWeekStart = normalizeWeekStart(weeklyInputs.weekStart || fallbackWeekStart || getState().weeklyInputs.weekStart);
  const parsedWeeks = Number.parseInt(weeklyInputs.numWeeks, 10);
  const normalizedSelections = weeklyInputs.weeklyMioSelections && typeof weeklyInputs.weeklyMioSelections === 'object'
    ? { ...weeklyInputs.weeklyMioSelections }
    : {};

  if (weeklyInputs.mioChef && !normalizedSelections[normalizedWeekStart]) {
    normalizedSelections[normalizedWeekStart] = weeklyInputs.mioChef;
  }

  return {
    weekStart: normalizedWeekStart,
    numWeeks: Math.max(1, Math.min(8, parsedWeeks || 1)),
    mioChef: weeklyInputs.mioChef || normalizedSelections[normalizedWeekStart] || '',
    weeklyMioSelections: normalizedSelections,
    status: weeklyInputs.status || 'Draft',
    dailyOverrides: weeklyInputs.dailyOverrides && typeof weeklyInputs.dailyOverrides === 'object' ? weeklyInputs.dailyOverrides : {},
    availability: Array.isArray(weeklyInputs.availability) ? weeklyInputs.availability : [],
    additionalChefRequirements: Array.isArray(weeklyInputs.additionalChefRequirements) ? weeklyInputs.additionalChefRequirements : []
  };
}

export function getPersistedMioEligibilityMap() {
  const parsed = safeParse(localStorage.getItem(STORAGE_KEYS.mioEligibilityByChef), {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function savePersistedMioEligibilityMap(map) {
  try {
    localStorage.setItem(STORAGE_KEYS.mioEligibilityByChef, JSON.stringify(map));
  } catch {
    // Ignore storage failures; app should still function without persistence.
  }
}

export function applyPersistedMioEligibility() {
  const state = getState();
  const persisted = getPersistedMioEligibilityMap();
  state.staff.forEach((staff) => {
    if (Object.prototype.hasOwnProperty.call(persisted, staff.name)) {
      staff.mioEligible = !!persisted[staff.name];
    }
  });
}

export function persistAllMioEligibility() {
  const state = getState();
  const persisted = Object.fromEntries(state.staff.map((staff) => [staff.name, !!staff.mioEligible]));
  savePersistedMioEligibilityMap(persisted);
}

function getPersistedStaffProfilesMap() {
  const parsed = safeParse(localStorage.getItem(STORAGE_KEYS.staffProfilesByChef), {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function savePersistedStaffProfilesMap(map) {
  try {
    localStorage.setItem(STORAGE_KEYS.staffProfilesByChef, JSON.stringify(map));
  } catch {
    // Ignore storage failures.
  }
}

export function applyPersistedStaffProfiles() {
  const state = getState();
  const persisted = getPersistedStaffProfilesMap();
  state.staff.forEach((staff) => {
    const profile = persisted[staff.name];
    if (!profile || typeof profile !== 'object') return;
    if (profile.role) staff.role = profile.role;
    if (typeof profile.mioEligible === 'boolean') staff.mioEligible = profile.mioEligible;
    if (typeof profile.weekendRule === 'string') staff.weekendRule = profile.weekendRule;
    if (typeof profile.fixedDayOff === 'string') staff.fixedDayOff = profile.fixedDayOff;
    if (profile.skills && typeof profile.skills === 'object') {
      staff.skills = { ...(staff.skills || {}), ...profile.skills };
    }
  });
  state.staff = normalizeStaffRecords(state.staff);
}

export function persistAllStaffProfiles() {
  const state = getState();
  const persisted = Object.fromEntries(state.staff.map((staff) => [
    staff.name,
    {
      role: staff.role,
      mioEligible: !!staff.mioEligible,
      weekendRule: staff.weekendRule || '',
      fixedDayOff: staff.fixedDayOff || '',
      skills: { ...(staff.skills || {}) }
    }
  ]));
  savePersistedStaffProfilesMap(persisted);
}

function migrateLegacyAdditionalChefRequests(saved) {
  if (!saved?.weeklyInputs) return saved;

  const { dailyOverrides, weekStart, additionalChefRequirements } = saved.weeklyInputs;
  const hasOldExtra = dailyOverrides && Object.values(dailyOverrides).some((override) => override && (override.extraChefs || 0) > 0);
  const alreadyMigrated = Array.isArray(additionalChefRequirements) && additionalChefRequirements.length > 0;
  if (!hasOldExtra || alreadyMigrated || !weekStart) return saved;

  const normalizedWeekStart = normalizeWeekStart(weekStart);
  const weekDate = new Date(`${normalizedWeekStart}T00:00:00`);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayToDate = {};
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekDate);
    d.setDate(weekDate.getDate() + i);
    dayToDate[dayNames[d.getDay()]] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const converted = [];
  Object.entries(dailyOverrides).forEach(([dayName, override]) => {
    const count = override && typeof override.extraChefs === 'number' ? override.extraChefs : 0;
    if (count > 0 && dayToDate[dayName]) {
      converted.push({ date: dayToDate[dayName], count });
    }
  });

  if (converted.length) {
    saved.weeklyInputs.additionalChefRequirements = converted;
  }

  Object.keys(saved.weeklyInputs.dailyOverrides || {}).forEach((day) => {
    const entry = saved.weeklyInputs.dailyOverrides[day];
    if (!entry) return;
    delete entry.extraChefs;
    if (!Object.keys(entry).filter((key) => key !== 'extraChefs' && entry[key]).length) {
      delete saved.weeklyInputs.dailyOverrides[day];
    }
  });

  return saved;
}

export function migrateStorageIfNeeded() {
  const current = Number(localStorage.getItem(STORAGE_KEYS.schemaVersion) || 0);
  if (current >= CURRENT_SCHEMA_VERSION) return;

  if (current < 2) {
    const appState = getState();
    saveAppState(appState);
  }

  let saved = safeParse(localStorage.getItem(STORAGE_KEYS.appState), null);
  if (saved && typeof saved === 'object') {
    if (current < 3) {
      saved = migrateLegacyAdditionalChefRequests(saved);
    }
    if (current < 4) {
      const fallbackWeekStart = saved.weeklyInputs?.weekStart || getState().weeklyInputs.weekStart;
      saved.weeklyInputs = normalizeWeeklyInputsShape(saved.weeklyInputs, fallbackWeekStart);
    }
    if (current < 5 && Array.isArray(saved.staff)) {
      saved.staff = normalizeStaffRecords(saved.staff);
    }
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(saved));
  }

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
}

export function loadAppState() {
  const state = getState();
  const persisted = safeParse(localStorage.getItem(STORAGE_KEYS.appState), null);
  if (persisted && typeof persisted === 'object') {
    if (Array.isArray(persisted.staff)) state.staff = normalizeStaffRecords(persisted.staff);
    if (persisted.weeklyInputs && typeof persisted.weeklyInputs === 'object') {
      state.weeklyInputs = {
        ...state.weeklyInputs,
        ...normalizeWeeklyInputsShape(persisted.weeklyInputs, state.weeklyInputs.weekStart)
      };
    }
    if (persisted.settings && typeof persisted.settings === 'object') {
      state.settings = { ...state.settings, ...persisted.settings };
    }
    if (Array.isArray(persisted.history)) state.history = persisted.history;
    if (persisted.generatedRotas && typeof persisted.generatedRotas === 'object') {
      state.generatedRotas = { ...state.generatedRotas, ...persisted.generatedRotas };
    }
    if (persisted.uiState && typeof persisted.uiState === 'object') {
      state.uiState = { ...state.uiState, ...persisted.uiState };
    }
  }

  applyPersistedStaffProfiles();
  applyPersistedMioEligibility();
  syncCompatibilityViews();
}

export function saveAppState(state) {
  try {
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify({
      staff: normalizeStaffRecords(state.staff),
      settings: state.settings,
      weeklyInputs: normalizeWeeklyInputsShape(state.weeklyInputs, state.weeklyInputs.weekStart),
      generatedRotas: state.generatedRotas,
      history: state.history,
      uiState: state.uiState
    }));
    persistAllStaffProfiles();
    persistAllMioEligibility();
  } catch {
    // Ignore write failures; persistence should be best-effort.
  }
}

export function loadHistory() {
  const parsed = safeParse(localStorage.getItem(STORAGE_KEYS.history), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  } catch {
    // Ignore write failures.
  }
}
