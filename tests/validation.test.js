import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { validateRotaHardRules, isRotaValid } from '../js/validation.js?v=20260714';

function setupState() {
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

export async function runValidationTests(assert) {
  const state = setupState();
  const result = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    changes: '',
    dailyOverrides: {},
    availability: []
  });

  const validation = validateRotaHardRules({ rota: result.rota, state, inputs: state.weeklyInputs, summary: result.summary });
  assert(validation.length > 0, 'Validator returns structured hard-rule checks');
  assert(validation.every((v) => v.ruleId && typeof v.passed === 'boolean' && v.severity === 'hard'), 'Validator result shape is correct');

  const hasSeniorCoverageRule = validation.some((v) => v.ruleId === 'H008');
  assert(hasSeniorCoverageRule, 'Every day has senior coverage rule check');

  const corrupted = JSON.parse(JSON.stringify(result.rota));
  corrupted[0].assignments = corrupted[0].assignments.filter((a) => a.section !== 'Breakfast');
  const corruptedValidation = validateRotaHardRules({ rota: corrupted, state, inputs: state.weeklyInputs, summary: result.summary });
  assert(corruptedValidation.some((v) => v.ruleId === 'H006' && !v.passed), 'Validator catches intentionally corrupted rota');

  const invalid = !isRotaValid(corruptedValidation);
  assert(invalid, 'Invalid rotas are rejected, not merely warned');

  const unavailableChef = 'Dan';
  state.weeklyInputs.availability = [{ chef: unavailableChef, type: 'Unavailable', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }];
  syncCompatibilityViews();
  const rerun = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    changes: '',
    dailyOverrides: {},
    availability: state.weeklyInputs.availability
  });
  const unavailableWorked = rerun.rota.some((day) => day.date === '2026-07-14' && day.chefs.includes(unavailableChef));
  assert(!unavailableWorked, 'Unavailable request counts as normal day off for scheduling');
}
