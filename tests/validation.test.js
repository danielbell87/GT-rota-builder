import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid } from '../js/validation.js?v=20260714';

function setupState() {
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Dan';
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
  assert((result.status === 'ok') === isRotaValid(validation), 'Solver status ok is only returned when hard validation passes');
  assert(validation.length > 0, 'Validator returns structured hard-rule checks');
  assert(validation.every((v) => v.ruleId && typeof v.passed === 'boolean' && v.severity === 'hard'), 'Validator result shape is correct');

  const hasSeniorCoverageRule = validation.some((v) => v.ruleId === 'H008');
  assert(hasSeniorCoverageRule, 'Every day has senior coverage rule check');
  const mioPatternRulesPresent = ['H015', 'H022', 'H023'].every((ruleId) => validation.some((v) => v.ruleId === ruleId));
  assert(mioPatternRulesPresent, 'Validation includes selected MIO chef pattern hard rules');
  assert(validation.filter((v) => ['H015', 'H022', 'H023'].includes(v.ruleId)).every((v) => v.passed), 'Baseline satisfies selected MIO chef hard pattern checks');

  const softValidation = validateRotaSoftRules({ rota: result.rota, state, inputs: state.weeklyInputs });
  const passPreferenceChecks = softValidation.filter((v) => v.ruleId === 'prefer-senior-on-pass');
  assert(passPreferenceChecks.length === 4, 'Soft validation reports senior-on-Pass checks Thu-Sun');
  assert(passPreferenceChecks.every((v) => v.passed), 'Baseline rota satisfies senior-on-Pass soft preference');

  const corrupted = JSON.parse(JSON.stringify(result.rota));
  corrupted[0].assignments = corrupted[0].assignments.filter((a) => a.section !== 'Breakfast');
  const corruptedValidation = validateRotaHardRules({ rota: corrupted, state, inputs: state.weeklyInputs, summary: result.summary });
  assert(corruptedValidation.some((v) => v.ruleId === 'H006' && !v.passed), 'Validator catches intentionally corrupted rota');

  const invalid = !isRotaValid(corruptedValidation);
  assert(invalid, 'Invalid rotas are rejected, not merely warned');

  const mioOverlapCorrupted = JSON.parse(JSON.stringify(result.rota));
  const monday = mioOverlapCorrupted.find((day) => day.dayName === 'Monday');
  if (monday) {
    monday.chefs.push('Dan');
  }
  const mioOverlapValidation = validateRotaHardRules({ rota: mioOverlapCorrupted, state, inputs: state.weeklyInputs, summary: result.summary });
  assert(mioOverlapValidation.some((v) => v.ruleId === 'H023' && !v.passed), 'Hard validation rejects same-day GT and MIO for selected MIO chef');

  const softCorrupted = JSON.parse(JSON.stringify(result.rota));
  const thursday = softCorrupted.find((day) => day.dayName === 'Thursday');
  if (thursday) {
    const pass = thursday.assignments.find((a) => a.section === 'Pass');
    if (pass) pass.chef = 'Dan';
  }
  const softCorruptedValidation = validateRotaSoftRules({ rota: softCorrupted, state, inputs: state.weeklyInputs });
  assert(
    softCorruptedValidation.some((v) => v.ruleId === 'prefer-senior-on-pass' && !v.passed),
    'Soft validation flags non-senior Pass assignment when a senior is available'
  );

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
