import { getState, syncCompatibilityViews } from './state.js';
import { normalizeStaffRecords } from './staff.js';
import { getWeekStartAtOffset, normalizeWeekStart } from './utils.js';
import { DEFAULT_STAFF } from '../data/default-staff.js';

export const STORAGE_KEYS = {
  schemaVersion: 'gtRota.schemaVersion',
  appState: 'gtRota.state.v2',
  history: 'gtRota.history.v1'
};

const LEGACY_MIO_ELIGIBILITY_KEY = 'gtRota.mioEligibilityByChef';
const LEGACY_STAFF_PROFILES_KEY = 'gtRota.staffProfilesByChef';
const CURRENT_SCHEMA_VERSION = 14;

function normalizeManualEditing(value) {
  if (!value || typeof value !== 'object') return null;
  const cleanSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const { locks, ...clean } = snapshot;
    return clean;
  };
  const { locks, ...clean } = value;
  return {
    ...clean,
    originals: clean.originals && typeof clean.originals === 'object' ? clean.originals : {},
    edits: clean.edits && typeof clean.edits === 'object' ? clean.edits : {},
    undo: Array.isArray(clean.undo) ? clean.undo.map(cleanSnapshot) : [],
    redo: Array.isArray(clean.redo) ? clean.redo.map(cleanSnapshot) : []
  };
}

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
  const numWeeks = Math.max(1, Math.min(8, parsedWeeks || 1));
  const savedSelections = weeklyInputs.weeklyMioSelections && typeof weeklyInputs.weeklyMioSelections === 'object'
    ? weeklyInputs.weeklyMioSelections
    : {};
  const activeWeekStarts = Array.from({ length: numWeeks }, (_, index) => getWeekStartAtOffset(normalizedWeekStart, index));
  const normalizedSelections = Object.fromEntries(activeWeekStarts
    .filter((weekStart) => Object.prototype.hasOwnProperty.call(savedSelections, weekStart))
    .map((weekStart) => [weekStart, typeof savedSelections[weekStart] === 'string' ? savedSelections[weekStart] : '']));

  if (!Object.prototype.hasOwnProperty.call(normalizedSelections, normalizedWeekStart)) {
    normalizedSelections[normalizedWeekStart] = typeof weeklyInputs.mioChef === 'string' ? weeklyInputs.mioChef : '';
  }

  return {
    weekStart: normalizedWeekStart,
    numWeeks,
    mioChef: normalizedSelections[normalizedWeekStart],
    weeklyMioSelections: normalizedSelections,
    status: weeklyInputs.status || 'Draft',
    dailyOverrides: weeklyInputs.dailyOverrides && typeof weeklyInputs.dailyOverrides === 'object' ? weeklyInputs.dailyOverrides : {},
    availability: Array.isArray(weeklyInputs.availability) ? weeklyInputs.availability : [],
    additionalChefRequirements: Array.isArray(weeklyInputs.additionalChefRequirements) ? weeklyInputs.additionalChefRequirements : []
  };
}

function migrateLegacyChefStores(staff = []) {
  const mioEligibility = safeParse(localStorage.getItem(LEGACY_MIO_ELIGIBILITY_KEY), {});
  const profiles = safeParse(localStorage.getItem(LEGACY_STAFF_PROFILES_KEY), {});
  return normalizeStaffRecords(staff.map((chef) => {
    const profile = profiles?.[chef.name];
    const merged = profile && typeof profile === 'object'
      ? {
          ...chef,
          role: profile.role || chef.role,
          skills: profile.skills && typeof profile.skills === 'object'
            ? { ...(chef.skills || {}), ...profile.skills }
            : chef.skills,
          preferredBreakfast: chef.preferredBreakfast || profile.preferredBreakfast,
          mioEligible: typeof profile.mioEligible === 'boolean' ? profile.mioEligible : chef.mioEligible
        }
      : { ...chef };
    if (mioEligibility && Object.prototype.hasOwnProperty.call(mioEligibility, chef.name)) {
      merged.mioEligible = !!mioEligibility[chef.name];
    }
    return merged;
  }));
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
    if (current < 6 && Array.isArray(saved.staff)) {
      saved.staff = normalizeStaffRecords(saved.staff);
    }
    if (current < 7 && Array.isArray(saved.staff)) {
      saved.staff = normalizeStaffRecords(saved.staff);
    }
    if (current < 8 && Array.isArray(saved.staff)) {
      saved.staff = normalizeStaffRecords(saved.staff);
    }
    if (current < 9 && Array.isArray(saved.staff)) {
      saved.staff = migrateLegacyChefStores(saved.staff);
    }
    if (current < 10 && Array.isArray(saved.staff)) {
      saved.staff = normalizeStaffRecords(saved.staff);
    }
    if (current < 11) {
      const fallbackWeekStart = saved.weeklyInputs?.weekStart || getState().weeklyInputs.weekStart;
      saved.weeklyInputs = normalizeWeeklyInputsShape(saved.weeklyInputs, fallbackWeekStart);
    }
    if (current < 12 && Array.isArray(saved.staff) && saved.staff.length === 0) {
      saved.staff = normalizeStaffRecords(JSON.parse(JSON.stringify(DEFAULT_STAFF)));
    }
    if (current < 14) saved.manualEditing = normalizeManualEditing(saved.manualEditing);
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(saved));
  }

  if (current < 9) {
    localStorage.removeItem(LEGACY_MIO_ELIGIBILITY_KEY);
    localStorage.removeItem(LEGACY_STAFF_PROFILES_KEY);
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
    if (persisted.manualEditing && typeof persisted.manualEditing === 'object') state.manualEditing = normalizeManualEditing(persisted.manualEditing);
  }

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
      uiState: state.uiState,
      manualEditing: normalizeManualEditing(state.manualEditing)
    }));
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
