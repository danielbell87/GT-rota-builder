import { getState, getDefaultWeek, setWeekStart, setMioChef, setAvailability, setAdditionalChefRequirements, setNumWeeks } from './state.js';
import { normalizeWeekStart } from './utils.js';

export function collectWeeklyInputsFromDom() {
  const state = getState();
  const rawWeek = document.getElementById('weekStart').value || getDefaultWeek();
  const normalizedWeek = normalizeWeekStart(rawWeek);
  setWeekStart(normalizedWeek);
  setMioChef(document.getElementById('mioChef').value);
  const rawNumWeeks = parseInt(document.getElementById('numWeeks')?.value || '1', 10);
  setNumWeeks(rawNumWeeks);
  setAvailability(state.weeklyInputs.availability);

  return {
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
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
  if (!dateStr) return 'Please select a date.';
  const parts = weekStart.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const dp = dateStr.split('-').map(Number);
  const selected = new Date(dp[0], dp[1] - 1, dp[2]);
  if (selected < start || selected > end) {
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Date must be within the selected week (${fmt(start)} – ${fmt(end)}).`;
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
