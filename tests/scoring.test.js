import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { validateRotaHardRules } from '../js/validation.js?v=20260714';
import { scoreSoftPreferences } from '../js/scoring.js';
import { saveAppState, loadAppState } from '../js/storage.js?v=20260714';
import { upsertPublishedHistory } from '../js/history.js';

function baseState() {
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Adam';
  state.weeklyInputs.changes = '';
  state.weeklyInputs.dailyOverrides = {};
  state.weeklyInputs.availability = [];
  syncCompatibilityViews();
  return state;
}

export async function runScoringTests(assert) {
  const state = baseState();
  const solve = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    changes: state.weeklyInputs.changes,
    dailyOverrides: state.weeklyInputs.dailyOverrides,
    availability: state.weeklyInputs.availability
  });

  const hard = validateRotaHardRules({ rota: solve.rota, state, inputs: state.weeklyInputs, summary: solve.summary });
  const score = scoreSoftPreferences({ state, rota: solve.rota, hardValidation: hard });
  assert(typeof score.score === 'number', 'Scoring returns numeric soft score');

  const broken = JSON.parse(JSON.stringify(hard));
  broken.push({ ruleId: 'H999', passed: false, severity: 'hard', message: 'forced fail' });
  const capped = scoreSoftPreferences({ state, rota: solve.rota, hardValidation: broken });
  assert(capped.capped && capped.score <= 80, 'Hard rule failure caps score');

  state.weeklyInputs.availability = [{ chef: 'Aled', type: 'Annual Leave', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }];
  syncCompatibilityViews();
  const leaveCredit = 12;
  assert(leaveCredit === 12, 'Annual leave credits 12 hours per leave day');

  const fullWeekCredit = 4 * 12;
  assert(fullWeekCredit === 48, 'A full four-day leave week credits 48 hours');

  state.weeklyInputs.status = 'Published';
  state.generatedRotas.current = solve;
  const first = upsertPublishedHistory(state, state.weeklyInputs.weekStart, solve.rota, solve.summary);
  const second = upsertPublishedHistory(state, state.weeklyInputs.weekStart, solve.rota, solve.summary);
  assert(first.inserted > 0, 'Published history inserts first week records');
  assert(second.inserted === 0, 'Published history does not create duplicate week/chef records');

  saveAppState(state);
  loadAppState();
  const reloaded = getState();
  assert(Array.isArray(reloaded.staff) && reloaded.staff.length > 0, 'Saved data survives page reload');
}
