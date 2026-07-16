import { getState, getDefaultWeek, setWeekStart, setMioChef, setDailyOverrides, setAvailability } from './state.js';
import { normalizeWeekStart } from './utils.js';

export function collectWeeklyInputsFromDom() {
  const state = getState();
  const rawWeek = document.getElementById('weekStart').value || getDefaultWeek();
  const dailyOverrides = {};

  document.querySelectorAll('[data-day]').forEach((row) => {
    const day = row.dataset.day;
    const eventName = row.querySelector('[data-event-name]').value;
    const extraChefs = parseInt(row.querySelector('[data-extra-chefs]').value, 10) || 0;
    if (eventName || extraChefs > 0) {
      dailyOverrides[day] = { eventName, extraChefs };
    }
  });

  const normalizedWeek = normalizeWeekStart(rawWeek);
  setWeekStart(normalizedWeek);
  setMioChef(document.getElementById('mioChef').value);
  setDailyOverrides(dailyOverrides);
  setAvailability(state.weeklyInputs.availability);

  return {
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    dailyOverrides: state.weeklyInputs.dailyOverrides,
    availability: state.weeklyInputs.availability,
    status: state.weeklyInputs.status
  };
}

export function updateDailyOverrideFromRow(row) {
  const state = getState();
  const day = row.dataset.day;
  const eventName = row.querySelector('[data-event-name]').value;
  const extraChefs = parseInt(row.querySelector('[data-extra-chefs]').value, 10) || 0;
  const overrides = { ...state.weeklyInputs.dailyOverrides };

  if (eventName || extraChefs > 0) {
    overrides[day] = { eventName, extraChefs };
  } else {
    delete overrides[day];
  }

  setDailyOverrides(overrides);
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
