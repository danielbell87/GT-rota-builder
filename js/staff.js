import { CHEF_ROLES, EDITABLE_SKILL_SECTIONS, WEEKDAYS } from './constants.js';
import { DEFAULT_STAFF } from '../data/default-staff.js';
import { getState, resetStateToDefaults, syncCompatibilityViews } from './state.js';
import { normalizeSectionSkills, parseSectionLevel } from './section-levels.js';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chef';
}

export function createChefId(name, index, usedIds = new Set()) {
  const base = `chef-${slugify(name)}-${Math.max(index + 1, 1)}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function normalizeChefRecord(chef = {}, index = 0, usedIds = new Set()) {
  const skills = normalizeSectionSkills(chef.skills);
  const role = CHEF_ROLES.includes(chef.role) ? chef.role : '';
  const normalizedName = String(chef.name || '').trim();
  const preferredDaysOff = Array.isArray(chef.preferredDaysOff)
    ? chef.preferredDaysOff.filter((day) => WEEKDAYS.includes(day))
    : [];
  if (WEEKDAYS.includes(chef.fixedDayOff)) preferredDaysOff.push(chef.fixedDayOff);
  const normalized = {
    id: typeof chef.id === 'string' && chef.id.trim() ? chef.id.trim() : createChefId(normalizedName || `chef-${index + 1}`, index, usedIds),
    name: normalizedName,
    role,
    senior: chef.senior === true || chef.seniorStatus === true,
    breakfastEligible: chef.breakfastEligible !== false,
    preferredBreakfast: WEEKDAYS.includes(chef.preferredBreakfast) ? chef.preferredBreakfast : '',
    mioEligible: !!chef.mioEligible,
    preferredDaysOff: [...new Set(preferredDaysOff)],
    skills,
    notes: String(chef.notes || '')
  };

  if (!usedIds.has(normalized.id)) usedIds.add(normalized.id);
  return normalized;
}

export function normalizeStaffRecords(staff = []) {
  const usedIds = new Set();
  return (Array.isArray(staff) ? staff : []).map((chef, index) => normalizeChefRecord(chef, index, usedIds));
}

export function getChefSoftPreferenceDetails(chef = {}) {
  const preferredDaysOff = [...new Set(
    (Array.isArray(chef.preferredDaysOff) ? chef.preferredDaysOff : [])
      .filter((day) => WEEKDAYS.includes(day))
  )];
  const preferredBreakfast = WEEKDAYS.includes(chef.preferredBreakfast)
    ? chef.preferredBreakfast
    : '';
  const summary = [
    preferredDaysOff.length ? `Preferred days off: ${preferredDaysOff.join(', ')}` : '',
    preferredBreakfast ? `Preferred breakfast: ${preferredBreakfast}` : ''
  ].filter(Boolean).join('. ');

  return {
    count: preferredDaysOff.length + (preferredBreakfast ? 1 : 0),
    preferredDaysOff,
    preferredBreakfast,
    summary
  };
}

export function getChefById(chefId, state = getState()) {
  return state.staff.find((chef) => chef.id === chefId) || null;
}

export function createBlankChefDraft() {
  return normalizeChefRecord({
    id: '',
    name: '',
    role: '',
    senior: false,
    breakfastEligible: true,
    preferredBreakfast: '',
    mioEligible: false,
    preferredDaysOff: [],
    skills: Object.fromEntries(EDITABLE_SKILL_SECTIONS.map((section) => [section, 0])),
    notes: ''
  });
}

export function createChefDraft(chef) {
  return normalizeChefRecord(chef, 0, new Set());
}

export function validateChefData(chef, options = {}) {
  const existingStaff = normalizeStaffRecords(options.existingStaff || getState().staff);
  const currentChefId = options.currentChefId || null;
  const normalized = normalizeChefRecord(chef, existingStaff.length, new Set(existingStaff.map((item) => item.id)));
  const name = normalized.name.trim();

  if (!name) {
    return { valid: false, field: 'chefNameInput', message: 'Chef name is required.' };
  }

  const duplicate = existingStaff.find((item) => item.id !== currentChefId && item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    return { valid: false, field: 'chefNameInput', message: 'Chef names must be unique.' };
  }

  if (!CHEF_ROLES.includes(normalized.role)) {
    return { valid: false, field: 'chefRoleInput', message: 'Please choose a valid chef role.' };
  }

  for (const section of EDITABLE_SKILL_SECTIONS) {
    const rawValue = chef.skills?.[section] ?? normalized.skills?.[section];
    const score = parseSectionLevel(rawValue);
    if (score === null) {
      return { valid: false, field: `chefSkill${section}Input`, message: `${section} level must be one of: Should not cover, In training, Competent, or Preferred.` };
    }
  }

  return { valid: true, message: '', field: '' };
}

function updateChefNameReferences(oldName, newName, state) {
  if (!oldName || !newName || oldName === newName) return;

  state.weeklyInputs.availability = (state.weeklyInputs.availability || []).map((entry) => (
    entry.chef === oldName ? { ...entry, chef: newName } : entry
  ));

  if (state.weeklyInputs.mioChef === oldName) {
    state.weeklyInputs.mioChef = newName;
  }

  const selections = state.weeklyInputs.weeklyMioSelections || {};
  Object.keys(selections).forEach((weekStart) => {
    if (selections[weekStart] === oldName) {
      selections[weekStart] = newName;
    }
  });

  syncCompatibilityViews();
}

function removeChefReferences(chefName, state) {
  if (!chefName) return;

  state.weeklyInputs.availability = (state.weeklyInputs.availability || []).filter((entry) => entry.chef !== chefName);

  if (state.weeklyInputs.mioChef === chefName) {
    state.weeklyInputs.mioChef = '';
  }

  const selections = state.weeklyInputs.weeklyMioSelections || {};
  Object.keys(selections).forEach((weekStart) => {
    if (selections[weekStart] === chefName) {
      selections[weekStart] = '';
    }
  });

  syncCompatibilityViews();
}

export function addChef(chef) {
  const state = getState();
  const validated = validateChefData(chef, { existingStaff: state.staff });
  if (!validated.valid) return validated;

  const usedIds = new Set(state.staff.map((item) => item.id).filter(Boolean));
  const normalized = normalizeChefRecord(chef, state.staff.length, usedIds);
  state.staff.push(normalized);
  syncCompatibilityViews();
  return { valid: true, chef: normalized, message: '' };
}

export function updateChef(chefId, chef) {
  const state = getState();
  const index = state.staff.findIndex((item) => item.id === chefId);
  if (index < 0) {
    return { valid: false, field: '', message: 'Chef could not be found.' };
  }

  const validated = validateChefData(chef, { existingStaff: state.staff, currentChefId: chefId });
  if (!validated.valid) return validated;

  const current = state.staff[index];
  const normalized = normalizeChefRecord({ ...chef, id: current.id }, index, new Set(state.staff.map((item) => item.id)));
  state.staff[index] = normalized;
  updateChefNameReferences(current.name, normalized.name, state);
  syncCompatibilityViews();
  return { valid: true, chef: normalized, message: '' };
}

export function removeChef(chefId) {
  const state = getState();
  const index = state.staff.findIndex((item) => item.id === chefId);
  if (index < 0) return null;
  const [removed] = state.staff.splice(index, 1);
  removeChefReferences(removed.name, state);
  syncCompatibilityViews();
  return removed;
}

export function resetStaffToDefaults() {
  resetStateToDefaults();
  const state = getState();
  state.staff = JSON.parse(JSON.stringify(DEFAULT_STAFF));
  syncCompatibilityViews();
}
