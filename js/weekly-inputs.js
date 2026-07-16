import {
  getState,
  getDefaultWeek,
  setWeekStart,
  setMioChef,
  setAvailability,
  setAdditionalChefRequirements,
  setNumWeeks,
  setWeeklyMioChef
} from './state.js';
import { normalizeWeekStart, getPlanningHorizon, isDateWithinRange } from './utils.js';

function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`GT Rota Builder is missing required element #${id}`);
  return element;
}

export function collectWeeklyInputsFromDom() {
  const state = getState();
  const weekStartEl = getRequiredElement('weekStart');
  const numWeeksEl = getRequiredElement('numWeeks');
  const mioChefEl = getRequiredElement('mioChef');

  const rawWeek = weekStartEl.value || getDefaultWeek();
  const normalizedWeek = normalizeWeekStart(rawWeek);
  setWeekStart(normalizedWeek);

  const rawNumWeeks = Number.parseInt(numWeeksEl.value || String(state.weeklyInputs.numWeeks || 1), 10);
  setNumWeeks(rawNumWeeks);

  if (state.weeklyInputs.numWeeks === 1) {
    setMioChef(mioChefEl.value);
    setWeeklyMioChef(normalizedWeek, mioChefEl.value);
  }

  setAvailability(state.weeklyInputs.availability);

  return {
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    numWeeks: state.weeklyInputs.numWeeks,
    weeklyMioSelections: { ...(state.weeklyInputs.weeklyMioSelections || {}) },
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements || [],
    availability: state.weeklyInputs.availability,
    status: state.weeklyInputs.status
  };
}

export function addAvailabilityEntry() {
  const state = getState();
  const date = state.weeklyInputs.weekStart || getDefaultWeek();
  const chefName = state.staff[0]?.name || '';
  const next = state.weeklyInputs.availability.slice();
  next.push({ chef: chefName, type: 'Unavailable', startDate: date, finishDate: date, notes: '' });
  setAvailability(next);
}

export function removeAvailabilityEntry(index) {
  const state = getState();
  const next = state.weeklyInputs.availability.slice();
  next.splice(index, 1);
  setAvailability(next);
}

export function updateAvailabilityField(index, key, value) {
  const state = getState();
  const next = state.weeklyInputs.availability.slice();
  if (!next[index]) return;
  next[index] = { ...next[index], [key]: value };
  setAvailability(next);
}

export function addAdditionalChefRequest(date, count) {
  const state = getState();
  const existing = (state.weeklyInputs.additionalChefRequirements || []).slice();
  const idx = existing.findIndex((request) => request.date === date);
  if (idx >= 0) {
    existing[idx] = { date, count };
  } else {
    existing.push({ date, count });
  }
  setAdditionalChefRequirements(existing);
}

export function updateAdditionalChefRequest(oldDate, newDate, count) {
  const state = getState();
  let existing = (state.weeklyInputs.additionalChefRequirements || []).slice();
  existing = existing.filter((request) => request.date !== oldDate && request.date !== newDate);
  existing.push({ date: newDate, count });
  setAdditionalChefRequirements(existing);
}

export function removeAdditionalChefRequest(date) {
  const state = getState();
  const updated = (state.weeklyInputs.additionalChefRequirements || []).filter((request) => request.date !== date);
  setAdditionalChefRequirements(updated);
}

export function validateAdditionalChefDate(dateStr, weekStart, numWeeks = 1) {
  if (!dateStr) return 'Please select a date.';
  const horizon = getPlanningHorizon(weekStart, numWeeks);
  if (!isDateWithinRange(dateStr, horizon.start, horizon.end)) {
    const fmt = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Date must be within the selected planning horizon (${fmt(horizon.startDate)} – ${fmt(horizon.endDate)}).`;
  }
  return '';
}

export function validateAdditionalChefCount(rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) return 'Please enter a quantity.';
  const n = Number(rawValue);
  if (!Number.isInteger(n)) return 'Quantity must be a whole number.';
  if (n < 1) return 'Quantity must be at least 1.';
  if (n > 5) return 'Quantity must be 5 or fewer.';
  return '';
}

export function filterAvailabilityForWeek(entries, weekStart) {
  const normalizedWeekStart = normalizeWeekStart(weekStart);
  const weekDates = new Set(Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${normalizedWeekStart}T00:00:00`);
    date.setDate(date.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }));

  return (entries || []).filter((entry) => {
    const start = entry.startDate || entry.date;
    const finish = entry.finishDate || entry.date || start;
    if (!start || !finish) return false;
    const startDate = new Date(`${start}T00:00:00`);
    const finishDate = new Date(`${finish}T00:00:00`);
    for (let current = new Date(startDate); current <= finishDate; current.setDate(current.getDate() + 1)) {
      const currentDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      if (weekDates.has(currentDate)) return true;
    }
    return false;
  });
}

export function filterAdditionalChefRequirementsForWeek(entries, weekStart) {
  const normalizedWeekStart = normalizeWeekStart(weekStart);
  const end = getPlanningHorizon(normalizedWeekStart, 1).end;
  return (entries || []).filter((entry) => !!entry?.date && isDateWithinRange(entry.date, normalizedWeekStart, end));
}
