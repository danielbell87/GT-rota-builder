import { CORE_SECTIONS } from './constants.js';

export const GT_SECTIONS = Object.freeze([...CORE_SECTIONS, 'Float']);

export function getGtChefNamesForDay(day = {}) {
  return [...new Set((day.assignments || [])
    .filter((assignment) => GT_SECTIONS.includes(assignment.section) && assignment.chef)
    .map((assignment) => assignment.chef))];
}

export function hasGtAssignment(day, chefName) {
  return getGtChefNamesForDay(day).includes(chefName);
}

export function syncDayGtChefs(day) {
  day.chefs = getGtChefNamesForDay(day);
  return day;
}

export function syncRotaGtChefs(rota = []) {
  rota.forEach(syncDayGtChefs);
  return rota;
}
