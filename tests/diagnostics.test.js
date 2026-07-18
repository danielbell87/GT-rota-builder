import { getState, resetStateToDefaults } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { buildRotaDiagnostics, checkRotaFeasibility, DIAGNOSTIC_CODES, summarizeDiagnostics } from '../js/diagnostics.js';

function inputs(state, overrides = {}) {
  return { weekStart: '2026-07-13', numWeeks: 1, mioChef: 'Dan', availability: [], additionalChefRequirements: [], ...overrides };
}

export async function runDiagnosticsTests(assert) {
  resetStateToDefaults();
  const state = getState();
  const baseInputs = inputs(state);
  const solved = buildRota(baseInputs);
  const week = { ...solved, weekStart: baseInputs.weekStart, inputs: baseInputs };
  const diagnostics = buildRotaDiagnostics({ state, week, hardValidation: solved.hardValidation, softScore: solved.softScore });
  assert(diagnostics.every((item) => item.code && item.type && item.message), 'Diagnostics: every rota decision is structured');
  assert(diagnostics.some((item) => item.code === DIAGNOSTIC_CODES.PREFERRED_DAY_OFF_SATISFIED), 'Diagnostics: satisfied preferred day off is reported');
  assert(!diagnostics.some((item) => item.code === DIAGNOSTIC_CODES.PREFERRED_DAY_OFF_MISSED && /fairness/i.test(item.message)), 'Diagnostics: weekend fairness is never blamed for a missed preferred day off');

  const aled = state.staff.find((chef) => chef.name === 'Aled');
  aled.preferredBreakfast = 'Monday';
  const breakfastDay = week.rota.find((day) => day.dayName === 'Monday');
  breakfastDay.assignments = breakfastDay.assignments.filter((assignment) => assignment.section !== 'Breakfast');
  breakfastDay.assignments.push({ chef: 'Aled', section: 'Breakfast' });
  const breakfastDiagnostics = buildRotaDiagnostics({ state, week, hardValidation: [], softScore: solved.softScore });
  assert(breakfastDiagnostics.some((item) => item.code === DIAGNOSTIC_CODES.PREFERRED_BREAKFAST_SATISFIED), 'Diagnostics: satisfied preferred breakfast is reported');

  const summary = summarizeDiagnostics(Array.from({ length: 7 }, (_, index) => ({ code: `code-${index}`, type: 'compromise', importance: 70 - index, message: `Decision ${index}` })), 5);
  assert(summary.visible.length === 5 && summary.remaining.length === 2, 'Diagnostics: default decision summary is limited to five items');

  resetStateToDefaults();
  const readyState = getState();
  const ready = checkRotaFeasibility({ state: readyState, inputs: inputs(readyState) });
  assert(ready.status !== 'blocked', 'Preflight: valid single-week inputs pass without proven errors');

  const unavailable = readyState.staff.slice(0, 7).map((chef) => ({ chef: chef.name, type: 'Unavailable', startDate: '2026-07-13', finishDate: '2026-07-13' }));
  const shortage = checkRotaFeasibility({ state: readyState, inputs: inputs(readyState, { availability: unavailable }) });
  assert(shortage.errors.some((item) => item.code === 'insufficient-chefs'), 'Preflight: insufficient available chefs is a blocking error');

  const noSeniorEntries = readyState.staff.filter((chef) => chef.senior).map((chef) => ({ chef: chef.name, type: 'Unavailable', startDate: '2026-07-14', finishDate: '2026-07-14' }));
  const noSenior = checkRotaFeasibility({ state: readyState, inputs: inputs(readyState, { availability: noSeniorEntries }) });
  assert(noSenior.errors.some((item) => item.code === 'no-senior'), 'Preflight: no available senior chef is a blocking error');

  const noBreakfastState = getState();
  noBreakfastState.staff.forEach((chef) => { chef.breakfastEligible = false; });
  const noBreakfast = checkRotaFeasibility({ state: noBreakfastState, inputs: inputs(noBreakfastState, { mioChef: '' }) });
  assert(noBreakfast.errors.some((item) => item.code === 'no-breakfast'), 'Preflight: no breakfast-eligible chef is a blocking error');

  resetStateToDefaults();
  const sectionState = getState();
  sectionState.staff.forEach((chef) => { chef.skills.Pastry = 0; });
  const noSection = checkRotaFeasibility({ state: sectionState, inputs: inputs(sectionState, { mioChef: '' }) });
  assert(noSection.errors.some((item) => item.code === 'uncovered-section' && item.section === 'Pastry'), 'Preflight: uncovered required section is a blocking error');

  resetStateToDefaults();
  const fragileState = getState();
  fragileState.staff.forEach((chef) => { if (chef.name !== 'Joel') chef.skills.Sauce = 0; });
  const fragile = checkRotaFeasibility({ state: fragileState, inputs: inputs(fragileState, { mioChef: '' }) });
  assert(fragile.warnings.some((item) => item.code === 'single-section-option' && item.section === 'Sauce'), 'Preflight: one possible section chef produces a warning');
}
