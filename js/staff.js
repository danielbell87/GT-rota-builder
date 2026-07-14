import { CHEF_ROLES, CORE_SECTIONS } from './constants.js';
import { DEFAULT_STAFF } from '../data/default-staff.js';
import { getState, resetStateToDefaults, syncCompatibilityViews } from './state.js';

export function validateChefData(chef) {
  if (!chef.name || !chef.name.trim()) return { valid: false, message: 'Chef name is required.' };
  if (!CHEF_ROLES.includes(chef.role)) return { valid: false, message: 'Chef role is invalid.' };
  for (const section of CORE_SECTIONS) {
    const score = Number(chef.skills?.[section] ?? 0);
    if (!Number.isFinite(score) || score < 0 || score > 3) {
      return { valid: false, message: `${chef.name}: ${section} skill must be between 0 and 3.` };
    }
  }
  return { valid: true, message: '' };
}

export function addChef(chef) {
  const state = getState();
  const validated = validateChefData(chef);
  if (!validated.valid) return validated;
  state.staff.push({ ...chef });
  syncCompatibilityViews();
  return { valid: true, message: '' };
}

export function removeChef(index) {
  const state = getState();
  state.staff.splice(index, 1);
  state.weeklyInputs.availability = state.weeklyInputs.availability.filter((entry) => entry.chef !== undefined);
  syncCompatibilityViews();
}

export function updateChefField(index, key, value) {
  const state = getState();
  if (!state.staff[index]) return;
  state.staff[index][key] = value;
}

export function updateChefSkill(index, section, value) {
  const state = getState();
  if (!state.staff[index]) return;
  if (!state.staff[index].skills) state.staff[index].skills = {};
  state.staff[index].skills[section] = Number(value);
}

export function resetStaffToDefaults() {
  resetStateToDefaults();
  const state = getState();
  state.staff = JSON.parse(JSON.stringify(DEFAULT_STAFF));
  syncCompatibilityViews();
}

export function createChefFromModalDom() {
  const skills = {};
  document.querySelectorAll('.new-skill-select').forEach((select) => {
    skills[select.dataset.skill] = Number(select.value);
  });
  return {
    name: document.getElementById('newChefName').value.trim(),
    role: document.getElementById('newChefRole').value,
    breakfastEligible: true,
    mioEligible: document.getElementById('newChefMio').value === 'true',
    weekendRule: document.getElementById('newChefWeekendRule').value,
    fixedDayOff: document.getElementById('newChefFixedDayOff').value,
    preferredDaysOff: [],
    preferredSections: [],
    servicePace: 'steady',
    skills,
    preferredBreakfast: '',
    notes: ''
  };
}
