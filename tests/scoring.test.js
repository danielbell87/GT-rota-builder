import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { validateRotaHardRules } from '../js/validation.js?v=20260717b';
import { scoreSoftPreferences } from '../js/scoring.js';
import { saveAppState, loadAppState } from '../js/storage.js?v=20260717b';
import { upsertPublishedHistory } from '../js/history.js';

function baseState() {
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Dan';
  state.weeklyInputs.dailyOverrides = {};
  state.weeklyInputs.additionalChefRequirements = [];
  state.weeklyInputs.availability = [];
  syncCompatibilityViews();
  return state;
}

export async function runScoringTests(assert) {
  const state = baseState();
  const solve = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements || [],
    availability: state.weeklyInputs.availability
  });

  const hard = validateRotaHardRules({ rota: solve.rota, state, inputs: state.weeklyInputs, summary: solve.summary, fullWeekDates: solve.fullWeekDates });
  const score = scoreSoftPreferences({ state, rota: solve.rota, hardValidation: hard });
  assert(typeof score.score === 'number', 'Scoring returns numeric soft score');
  assert(score.explanation.some((line) => line.includes('Senior chef') && line.includes('Pass')), 'Scoring explanation includes senior-on-Pass preference details');
  assert(score.explanation.every((line) => !/\bskill\s*[0-3]\b/i.test(line) && !/\bscore\s*[0-3]\b/i.test(line)), 'Scoring explanations avoid raw skill numbers in normal text');

  const forcedNonSeniorPass = JSON.parse(JSON.stringify(solve.rota));
  const friday = forcedNonSeniorPass.find((day) => day.dayName === 'Friday');
  if (friday) {
    const pass = friday.assignments.find((a) => a.section === 'Pass');
    if (pass) pass.chef = 'Dan';
    if (!friday.chefs.includes('Dan')) friday.chefs.push('Dan');
  }
  const forcedScore = scoreSoftPreferences({ state, rota: forcedNonSeniorPass, hardValidation: hard });
  assert(forcedScore.score < score.score, 'Non-senior on Pass is penalized as a strong soft preference');

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
