import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';

function setupBaseState() {
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Adam';
  state.weeklyInputs.changes = '';
  state.weeklyInputs.availability = [];
  state.weeklyInputs.dailyOverrides = {};
  syncCompatibilityViews();
  return state;
}

export async function runSolverTests(assert) {
  const state = setupBaseState();
  const base = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    changes: '',
    dailyOverrides: {},
    availability: []
  });

  assert(base.status === 'ok', 'Solver returns feasible rota for default week');

  const mylesDays = base.rota.reduce((count, day) => count + (day.chefs.includes('Myles') ? 1 : 0), 0);
  assert(mylesDays <= 4, 'Myles cannot be scheduled for seven days');

  const mylesWrongSection = base.rota.some((day) => day.assignments.some((a) => a.chef === 'Myles' && !['Larder', 'Breakfast', 'MIO'].includes(a.section)));
  assert(!mylesWrongSection, 'Myles cannot work outside Larder');

  const aledWeekend = base.rota.some((day) => ['Saturday', 'Sunday'].includes(day.dayName) && day.chefs.includes('Aled'));
  assert(!aledWeekend, 'Aled cannot work Saturday or Sunday');

  const charlieTuesday = base.rota.some((day) => day.dayName === 'Tuesday' && day.chefs.includes('Charlie'));
  assert(!charlieTuesday, 'Charlie cannot work Tuesday');

  const weekendMio = base.rota.some((day) => ['Saturday', 'Sunday'].includes(day.dayName) && day.assignments.some((a) => a.section === 'MIO'));
  assert(!weekendMio, 'MIO cannot occur at weekends');

  const breakfastByDay = base.rota.every((day) => day.assignments.filter((a) => a.section === 'Breakfast').length === 1);
  assert(breakfastByDay, 'Every day has exactly one breakfast chef');

  const breakfastInCore = base.rota.every((day) => {
    const breakfast = day.assignments.find((a) => a.section === 'Breakfast');
    if (!breakfast) return false;
    return day.assignments.some((a) => a.chef === breakfast.chef && ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'].includes(a.section));
  });
  assert(breakfastInCore, 'Breakfast chef appears in a core section');

  const monWedExact4 = base.rota.filter((d) => ['Monday', 'Tuesday', 'Wednesday'].includes(d.dayName)).every((day) => new Set(day.chefs).size === 4);
  assert(monWedExact4, 'Monday to Wednesday have exactly four unique GT chefs');

  const thuSunPass = base.rota.filter((d) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(d.dayName)).every((day) => day.assignments.some((a) => a.section === 'Pass'));
  assert(thuSunPass, 'Thursday to Sunday have Pass covered');

  const maxGtDays = Object.values(base.rota.reduce((acc, day) => {
    day.chefs.forEach((name) => { acc[name] = (acc[name] || 0) + 1; });
    return acc;
  }, {})).every((count) => count <= 4);
  assert(maxGtDays, 'No chef exceeds four GT working days');
}
