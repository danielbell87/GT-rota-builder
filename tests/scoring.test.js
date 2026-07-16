import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota, buildMultiWeekRota } from '../js/solver.js';
import { validateRotaHardRules } from '../js/validation.js?v=20260714';
import { scoreSoftPreferences } from '../js/scoring.js';
import { saveAppState, loadAppState } from '../js/storage.js?v=20260714';
import { upsertPublishedHistory } from '../js/history.js';

function baseState() {
  localStorage.clear();
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Dan';
  state.weeklyInputs.mioSelectionsByWeek = {
    '2026-07-13': 'Dan',
    '2026-07-20': 'Fred',
    '2026-07-27': 'Joel',
    '2026-08-03': 'Camilla'
  };
  state.weeklyInputs.numWeeks = 4;
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
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements,
    availability: state.weeklyInputs.availability
  });

  const hard = validateRotaHardRules({ rota: solve.rota, state, inputs: { ...state.weeklyInputs, mioChef: 'Dan' }, summary: solve.summary });
  const score = scoreSoftPreferences({ state, rota: solve.rota, hardValidation: hard });
  assert(typeof score.score === 'number', 'Scoring returns numeric soft score');
  assert(score.explanation.some((line) => line.includes('Senior chef') && line.includes('Pass')), 'Scoring explanation includes senior-on-Pass preference details');

  const forcedNonSeniorPass = JSON.parse(JSON.stringify(solve.rota));
  const friday = forcedNonSeniorPass.find((day) => day.dayName === 'Friday');
  if (friday) {
    const pass = friday.assignments.find((assignment) => assignment.section === 'Pass');
    if (pass) pass.chef = 'Dan';
    if (!friday.chefs.includes('Dan')) friday.chefs.push('Dan');
  }
  const forcedScore = scoreSoftPreferences({ state, rota: forcedNonSeniorPass, hardValidation: hard });
  assert(forcedScore.score < score.score, 'Non-senior on Pass is penalized as a strong soft preference');

  const broken = JSON.parse(JSON.stringify(hard));
  broken.push({ ruleId: 'H999', passed: false, severity: 'hard', message: 'forced fail' });
  const capped = scoreSoftPreferences({ state, rota: solve.rota, hardValidation: broken });
  assert(capped.capped && capped.score <= 80, 'Hard rule failure caps score');

  state.weeklyInputs.status = 'Published';
  const multiWeek = buildMultiWeekRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    mioSelectionsByWeek: state.weeklyInputs.mioSelectionsByWeek,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements,
    availability: state.weeklyInputs.availability
  }, 4);
  multiWeek.weeks.forEach((week) => {
    upsertPublishedHistory(state, {
      weekStart: week.weekStart,
      mioChef: week.mioChef,
      rota: week.rota,
      summary: week.summary,
      validation: {
        hard: week.hardValidation || [],
        messages: week.validation || []
      },
      fairnessSummary: week.fairnessSummary || [],
      status: week.status
    });
  });
  assert(state.history.length === 4, 'Publishing four weeks creates four records');
  assert(state.history.every((entry) => entry.weekStart && entry.mioChef && Array.isArray(entry.rota)), 'Published records preserve week-specific rota data');
  assert(state.history.every((entry) => Array.isArray(entry.validation?.hard) && Array.isArray(entry.fairnessAttendance)), 'Published records preserve validation and fairness attendance');

  saveAppState(state);
  loadAppState();
  const reloaded = getState();
  assert(Array.isArray(reloaded.staff) && reloaded.staff.length > 0, 'Saved data survives page reload');
}
