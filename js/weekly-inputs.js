import {
  getState,
  getDefaultWeek,
  setWeekStart,
  setMioChef,
  setMioSelectionsByWeek,
  setAvailability,
  setAdditionalChefRequirements,
  setNumWeeks
} from './state.js';
import { getPlanningHorizon, getPlanningWeekStarts, normalizeWeekStart } from './utils.js';

const MIO_ROTATION = ['Dan', 'Fred', 'Joel', 'Camilla', 'Brooke'];

export function getEligibleMioChefs(state = getState()) {
  return state.staff.filter((staff) => staff.mioEligible).map((staff) => staff.name);
}

export function getSuggestedMioChef(eligibleChefs, weekIndex) {
  if (!eligibleChefs.length) return '';
  const rotated = MIO_ROTATION.filter((name) => eligibleChefs.includes(name));
  const pool = rotated.length ? rotated : eligibleChefs;
  return pool[weekIndex % pool.length] || '';
}

export function ensureMioSelectionsForPlanningHorizon(state = getState()) {
  const weekStart = normalizeWeekStart(state.weeklyInputs.weekStart || getDefaultWeek());
  const weekStarts = getPlanningWeekStarts(weekStart, state.weeklyInputs.numWeeks || 1);
  const eligibleChefs = getEligibleMioChefs(state);
  const nextSelections = { ...(state.weeklyInputs.mioSelectionsByWeek || {}) };

  weekStarts.forEach((start, index) => {
    if (!eligibleChefs.includes(nextSelections[start])) {
      nextSelections[start] = getSuggestedMioChef(eligibleChefs, index);
    }
  });

  setMioSelectionsByWeek(nextSelections);
  setMioChef(nextSelections[weekStarts[0]] || eligibleChefs[0] || '');
  return nextSelections;
}

export function collectWeeklyInputsFromDom() {
  const state = getState();
  const rawWeek = document.getElementById('weekStart').value || getDefaultWeek();
  const normalizedWeek = normalizeWeekStart(rawWeek);
  setWeekStart(normalizedWeek);
  const rawNumWeeks = parseInt(document.getElementById('numWeeks')?.value || '1', 10);
  setNumWeeks(rawNumWeeks);
  const plannedWeekStarts = getPlanningWeekStarts(normalizedWeek, state.weeklyInputs.numWeeks || 1);
  const currentSelections = ensureMioSelectionsForPlanningHorizon(state);
  const weeklySelects = Array.from(document.querySelectorAll('.weekly-mio-select'));
  if (weeklySelects.length) {
    const nextSelections = { ...currentSelections };
    weeklySelects.forEach((select) => {
      const weekStart = select.getAttribute('data-week-start');
      if (weekStart) nextSelections[weekStart] = select.value;
    });
    setMioSelectionsByWeek(nextSelections);
  } else {
    const mioSelect = document.getElementById('mioChef');
    if (mioSelect) {
      const firstWeek = plannedWeekStarts[0];
      const nextSelections = { ...currentSelections, [firstWeek]: mioSelect.value };
      setMioSelectionsByWeek(nextSelections);
    }
  }
  const activeSelections = state.weeklyInputs.mioSelectionsByWeek || {};
  setMioChef(activeSelections[plannedWeekStarts[0]] || document.getElementById('mioChef')?.value || '');
  setAvailability(state.weeklyInputs.availability);

  return {
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    mioSelectionsByWeek: state.weeklyInputs.mioSelectionsByWeek || {},
    numWeeks: state.weeklyInputs.numWeeks,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements || [],
    availability: state.weeklyInputs.availability,
    status: state.weeklyInputs.status
  };
}

export function addAvailabilityEntry() {
  const state = getState();
  const chefName = state.staff[0]?.name || '';
  const date = state.weeklyInputs.weekStart || getDefaultWeek();
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
  const idx = existing.findIndex((r) => r.date === date);
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
  // Remove old entry and any existing entry for the new date (prevents duplicates)
  existing = existing.filter((r) => r.date !== oldDate && r.date !== newDate);
  existing.push({ date: newDate, count });
  setAdditionalChefRequirements(existing);
}

export function removeAdditionalChefRequest(date) {
  const state = getState();
  const updated = (state.weeklyInputs.additionalChefRequirements || []).filter((r) => r.date !== date);
  setAdditionalChefRequirements(updated);
}

export function validateAdditionalChefDate(dateStr, weekStart) {
  return validateAdditionalChefDateForHorizon(dateStr, weekStart, 1);
}

export function validateAdditionalChefDateForHorizon(dateStr, weekStart, numWeeks = 1) {
  if (!dateStr) return 'Please select a date.';
  const { startDate, endDate } = getPlanningHorizon(weekStart, numWeeks);
  const start = new Date(startDate.split('-').map(Number)[0], startDate.split('-').map(Number)[1] - 1, startDate.split('-').map(Number)[2]);
  const end = new Date(endDate.split('-').map(Number)[0], endDate.split('-').map(Number)[1] - 1, endDate.split('-').map(Number)[2]);
  const dp = dateStr.split('-').map(Number);
  const selected = new Date(dp[0], dp[1] - 1, dp[2]);
  if (selected < start || selected > end) {
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Date must be within the selected planning period (${fmt(start)} – ${fmt(end)}).`;
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
