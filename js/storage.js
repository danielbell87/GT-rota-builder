import { getState, syncCompatibilityViews } from './state.js';

export const STORAGE_KEYS = {
  schemaVersion: 'gtRota.schemaVersion',
  appState: 'gtRota.state.v2',
  history: 'gtRota.history.v1',
  mioEligibilityByChef: 'gtRota.mioEligibilityByChef',
  staffProfilesByChef: 'gtRota.staffProfilesByChef'
};

const CURRENT_SCHEMA_VERSION = 3;

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
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

export function persistMioEligibilityForChef(name, value) {
  if (!name) return;
  const persisted = getPersistedMioEligibilityMap();
  persisted[name] = !!value;
  savePersistedMioEligibilityMap(persisted);
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

export function renamePersistedStaffProfile(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const persisted = getPersistedStaffProfilesMap();
  if (Object.prototype.hasOwnProperty.call(persisted, oldName)) {
    persisted[newName] = persisted[oldName];
    delete persisted[oldName];
    savePersistedStaffProfilesMap(persisted);
  }
}

export function renamePersistedMioEligibility(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const persisted = getPersistedMioEligibilityMap();
  if (Object.prototype.hasOwnProperty.call(persisted, oldName)) {
    persisted[newName] = persisted[oldName];
    delete persisted[oldName];
    savePersistedMioEligibilityMap(persisted);
  }
}

export function migrateStorageIfNeeded() {
  const current = Number(localStorage.getItem(STORAGE_KEYS.schemaVersion) || 0);
  if (current >= CURRENT_SCHEMA_VERSION) return;

  if (current < 1) {
    // Legacy-only installations rely on profile and MIO keys; keep them untouched.
  }

  if (current < 2) {
    const appState = getState();
    saveAppState(appState);
  }

  if (current < 3) {
    // Migrate day-based dailyOverrides.extraChefs to date-based additionalChefRequirements
    const raw = localStorage.getItem(STORAGE_KEYS.appState);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved && saved.weeklyInputs) {
          const { dailyOverrides, weekStart, additionalChefRequirements } = saved.weeklyInputs;
          const hasOldExtra = dailyOverrides && Object.values(dailyOverrides).some((o) => o && (o.extraChefs || 0) > 0);
          const alreadyMigrated = Array.isArray(additionalChefRequirements) && additionalChefRequirements.length > 0;
          if (hasOldExtra && !alreadyMigrated && weekStart) {
            // Build day-name → date map from weekStart
            const parts = weekStart.split('-').map(Number);
            const weekDate = new Date(parts[0], parts[1] - 1, parts[2]);
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayToDate = {};
            for (let i = 0; i < 7; i += 1) {
              const d = new Date(weekDate);
              d.setDate(weekDate.getDate() + i);
              const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              dayToDate[dayNames[d.getDay()]] = ds;
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
            // Clear extraChefs from dailyOverrides to avoid double-counting
            Object.keys(saved.weeklyInputs.dailyOverrides).forEach((day) => {
              if (saved.weeklyInputs.dailyOverrides[day]) {
                delete saved.weeklyInputs.dailyOverrides[day].extraChefs;
              }
            });
            localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(saved));
          }
        }
      } catch {
        // Ignore migration errors; corrupt saved data will be overwritten on next save.
      }
    }
  }

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
}

export function loadAppState() {
  const state = getState();
  const persisted = safeParse(localStorage.getItem(STORAGE_KEYS.appState), null);
  if (persisted && typeof persisted === 'object') {
    if (Array.isArray(persisted.staff)) state.staff = persisted.staff;
    if (persisted.weeklyInputs && typeof persisted.weeklyInputs === 'object') {
      state.weeklyInputs = { ...state.weeklyInputs, ...persisted.weeklyInputs };
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
      staff: state.staff,
      settings: state.settings,
      weeklyInputs: state.weeklyInputs,
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
