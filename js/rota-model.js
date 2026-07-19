import { CORE_SECTIONS } from './constants.js';

export const GT_SECTIONS = Object.freeze([...CORE_SECTIONS, 'Float']);

function asChefNames(value) {
  if (Array.isArray(value)) return value.flatMap(asChefNames);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (value && typeof value === 'object' && typeof value.chef === 'string') return asChefNames(value.chef);
  return [];
}

export function normalizeDayAssignments(day = {}) {
  const normalized = [];
  const seenFloatChefs = new Set();
  const addAssignment = (section, chefValue) => {
    const names = section === 'Float' ? asChefNames(chefValue) : asChefNames(chefValue).slice(0, 1);
    names.forEach((chef) => {
      if (section === 'Float') {
        if (seenFloatChefs.has(chef)) return;
        seenFloatChefs.add(chef);
      }
      normalized.push({ section, chef });
    });
  };

  (Array.isArray(day.assignments) ? day.assignments : []).forEach((assignment) => {
    if (!assignment?.section) return;
    addAssignment(assignment.section, assignment.chef);
  });
  if (Object.prototype.hasOwnProperty.call(day, 'Float')) addAssignment('Float', day.Float);
  if (Object.prototype.hasOwnProperty.call(day, 'float')) addAssignment('Float', day.float);

  day.assignments = normalized;
  delete day.Float;
  delete day.float;
  return day.assignments;
}

export function getGtChefNamesForDay(day = {}) {
  normalizeDayAssignments(day);
  return [...new Set(day.assignments
    .filter((assignment) => GT_SECTIONS.includes(assignment.section) && assignment.chef)
    .map((assignment) => assignment.chef))];
}

export function hasGtAssignment(day, chefName) {
  return getGtChefNamesForDay(day).includes(chefName);
}

export function getGtDaysByChef(rota = []) {
  const counts = {};
  rota.forEach((day) => {
    getGtChefNamesForDay(day).forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return counts;
}

export function getVisibleGtChefDayTotal(rota = []) {
  return rota.reduce((total, day) => total + getGtChefNamesForDay(day).length, 0);
}

export function syncDayGtChefs(day) {
  normalizeDayAssignments(day);
  day.chefs = getGtChefNamesForDay(day);
  return day;
}

export function syncRotaGtChefs(rota = []) {
  rota.forEach(syncDayGtChefs);
  return rota;
}

export function normalizeOverallRotaResult(overallResult) {
  (overallResult?.weeks || []).forEach((week) => syncRotaGtChefs(week?.rota || []));
  return overallResult;
}
