import { CHEF_ROLES, CORE_SECTIONS, EDITABLE_SKILL_SECTIONS, SERVICE_PACE_OPTIONS, WEEKDAYS, WEEKEND_RULE_OPTIONS } from './constants.js';
import { DEFAULT_STAFF } from '../data/default-staff.js';
import { getState, resetStateToDefaults, syncCompatibilityViews } from './state.js';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chef';
}

function clampSkill(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(3, numeric));
}

export function getDefaultHierarchyForRole(role) {
  const index = CHEF_ROLES.indexOf(role);
  return index >= 0 ? index + 1 : CHEF_ROLES.indexOf('Chef de Partie') + 1;
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
  const skills = {};
  EDITABLE_SKILL_SECTIONS.forEach((section) => {
    skills[section] = clampSkill(chef.skills?.[section] ?? 0);
  });

  Object.entries(chef.skills || {}).forEach(([section, value]) => {
    if (!(section in skills)) skills[section] = clampSkill(value);
  });

  const role = CHEF_ROLES.includes(chef.role) ? chef.role : '';
  const hierarchy = Number.parseInt(chef.hierarchy, 10);
  const normalizedName = String(chef.name || '').trim();
  const normalized = {
    id: typeof chef.id === 'string' && chef.id.trim() ? chef.id.trim() : createChefId(normalizedName || `chef-${index + 1}`, index, usedIds),
    name: normalizedName,
    role,
    hierarchy: Number.isInteger(hierarchy) && hierarchy > 0 ? hierarchy : getDefaultHierarchyForRole(role),
    senior: !!chef.senior,
    seniorStatus: !!chef.seniorStatus,
    breakfastEligible: chef.breakfastEligible !== false,
    mioEligible: !!chef.mioEligible,
    weekendRule: WEEKEND_RULE_OPTIONS.includes(chef.weekendRule || '') ? (chef.weekendRule || '') : '',
    fixedDayOff: WEEKDAYS.includes(chef.fixedDayOff) ? chef.fixedDayOff : '',
    preferredDaysOff: Array.isArray(chef.preferredDaysOff) ? chef.preferredDaysOff.filter((day) => WEEKDAYS.includes(day)) : [],
    preferredSections: Array.isArray(chef.preferredSections) ? chef.preferredSections.filter((section) => EDITABLE_SKILL_SECTIONS.includes(section) || CORE_SECTIONS.includes(section)) : [],
    servicePace: SERVICE_PACE_OPTIONS.includes(chef.servicePace) ? chef.servicePace : 'steady',
    skills,
    preferredBreakfast: WEEKDAYS.includes(chef.preferredBreakfast) ? chef.preferredBreakfast : '',
    notes: String(chef.notes || '')
  };

  if (!usedIds.has(normalized.id)) usedIds.add(normalized.id);
  return normalized;
}

export function normalizeStaffRecords(staff = []) {
  const usedIds = new Set();
  return (Array.isArray(staff) ? staff : []).map((chef, index) => normalizeChefRecord(chef, index, usedIds));
}

export function getChefById(chefId, state = getState()) {
  return state.staff.find((chef) => chef.id === chefId) || null;
}

export function createBlankChefDraft() {
  return normalizeChefRecord({
    id: '',
    name: '',
    role: '',
    hierarchy: getDefaultHierarchyForRole('Chef de Partie'),
    senior: false,
    seniorStatus: false,
    breakfastEligible: true,
    mioEligible: false,
    weekendRule: '',
    fixedDayOff: '',
    preferredDaysOff: [],
    preferredSections: [],
    servicePace: 'steady',
    skills: Object.fromEntries(EDITABLE_SKILL_SECTIONS.map((section) => [section, 0])),
    preferredBreakfast: '',
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

  if (!Number.isInteger(normalized.hierarchy) || normalized.hierarchy < 1 || normalized.hierarchy > 99) {
    return { valid: false, field: 'chefHierarchyInput', message: 'Hierarchy must be a whole number between 1 and 99.' };
  }

  for (const section of EDITABLE_SKILL_SECTIONS) {
    const score = Number(normalized.skills?.[section] ?? 0);
    if (!Number.isFinite(score) || score < 0 || score > 3) {
      return { valid: false, field: `chefSkill${section}Input`, message: `${section} skill must be between 0 and 3.` };
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
