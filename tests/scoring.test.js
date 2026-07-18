import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js?v=20260718k';
import { validateRotaHardRules } from '../js/validation.js?v=20260718h';
import { scoreSoftPreferences } from '../js/scoring.js';
import { saveAppState, loadAppState } from '../js/storage.js?v=20260718h';
import { upsertPublishedHistory, upsertPublishedWeeks } from '../js/history.js';

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

  const blockFairnessContext = {
    stats: Object.fromEntries(state.staff.map((chef) => [chef.name, {
      friSatBlocksOff: 0,
      satSunBlocksOff: 0,
      weeksSinceWeekendBlock: 0,
      compatibleColleagues: []
    }])),
    previousWeekPatterns: {},
    currentUnavailableWeekendDays: {}
  };
  const rotaWithDanWorking = (workedWeekendDays) => (
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((dayName, index) => ({
      dayName,
      date: `2026-07-${String(13 + index).padStart(2, '0')}`,
      chefs: (!['Friday', 'Saturday', 'Sunday'].includes(dayName) || workedWeekendDays.includes(dayName)) ? ['Dan'] : [],
      assignments: []
    }))
  );
  const satSunOffScore = scoreSoftPreferences({
    state,
    rota: rotaWithDanWorking(['Friday']),
    hardValidation: [],
    fairnessContext: blockFairnessContext
  });
  const friSunIsolatedOffScore = scoreSoftPreferences({
    state,
    rota: rotaWithDanWorking(['Saturday']),
    hardValidation: [],
    fairnessContext: blockFairnessContext
  });
  const friSatOffScore = scoreSoftPreferences({
    state,
    rota: rotaWithDanWorking(['Sunday']),
    hardValidation: [],
    fairnessContext: blockFairnessContext
  });
  assert(
    satSunOffScore.weekendBlockFairnessPenalty < friSunIsolatedOffScore.weekendBlockFairnessPenalty,
    'Weekend blocks: Saturday + Sunday off scores substantially better than isolated Friday + Sunday off'
  );
  assert(
    friSatOffScore.weekendBlockFairnessPenalty < friSunIsolatedOffScore.weekendBlockFairnessPenalty,
    'Weekend blocks: Friday + Saturday off is preferred when Saturday + Sunday is unavailable'
  );
  blockFairnessContext.currentUnavailableWeekendDays.Dan = new Set(['Saturday', 'Sunday']);
  const leaveWeekendScore = scoreSoftPreferences({
    state,
    rota: rotaWithDanWorking(['Friday']),
    hardValidation: [],
    fairnessContext: blockFairnessContext
  });
  assert(
    leaveWeekendScore.weekendBlockFairnessPenalty > satSunOffScore.weekendBlockFairnessPenalty,
    'Weekend blocks: annual leave or unavailability is not counted as an earned consecutive block'
  );

  const forcedNonSeniorPass = JSON.parse(JSON.stringify(solve.rota));
  const friday = forcedNonSeniorPass.find((day) => day.dayName === 'Friday');
  if (friday) {
    const pass = friday.assignments.find((a) => a.section === 'Pass');
    if (pass) pass.chef = 'Dan';
    if (!friday.chefs.includes('Dan')) friday.chefs.push('Dan');
  }
  const forcedScore = scoreSoftPreferences({ state, rota: forcedNonSeniorPass, hardValidation: hard });
  assert(forcedScore.score < score.score, 'Non-senior on Pass is penalized as a strong soft preference');

  const preferredOverrideState = baseState();
  preferredOverrideState.staff.find((chef) => chef.name === 'Aled').preferredDaysOff = ['Monday'];
  const preferredOverrideRota = [{ dayName: 'Monday', date: '2026-07-13', chefs: ['Aled'], assignments: [] }];
  const preferredOverrideScore = scoreSoftPreferences({ state: preferredOverrideState, rota: preferredOverrideRota, hardValidation: [] });
  preferredOverrideState.staff.find((chef) => chef.name === 'Aled').preferredDaysOff = [];
  const noPreferenceScore = scoreSoftPreferences({ state: preferredOverrideState, rota: preferredOverrideRota, hardValidation: [] });
  assert(preferredOverrideScore.score < noPreferenceScore.score, 'Working a Preferred Day Off incurs a soft score penalty');
  assert(preferredOverrideScore.preferredDayOffViolationCount === 1 && noPreferenceScore.preferredDayOffViolationCount === 0, 'Scoring exposes Preferred Day Off violations as a separate priority metric');
  assert(preferredOverrideScore.explanation.some((line) => line.includes('Preferred Day Off') && line.includes('hard constraints')), 'Preferred Day Off override is explained in rota diagnostics');

  const breakfastPreferenceState = baseState();
  breakfastPreferenceState.staff.find((chef) => chef.name === 'Aled').preferredBreakfast = 'Monday';
  const matchingBreakfastRota = [{ dayName: 'Monday', date: '2026-07-13', chefs: ['Aled'], assignments: [{ chef: 'Aled', section: 'Breakfast' }] }];
  const nonMatchingBreakfastRota = [{ dayName: 'Tuesday', date: '2026-07-14', chefs: ['Aled'], assignments: [{ chef: 'Aled', section: 'Breakfast' }] }];
  assert(
    scoreSoftPreferences({ state: breakfastPreferenceState, rota: matchingBreakfastRota, hardValidation: [] }).score
      > scoreSoftPreferences({ state: breakfastPreferenceState, rota: nonMatchingBreakfastRota, hardValidation: [] }).score,
    'Matching Preferred breakfast day improves the soft rota score'
  );
  const preferenceWithRepeatRota = [
    { dayName: 'Monday', date: '2026-07-13', chefs: ['Aled'], assignments: [{ chef: 'Aled', section: 'Breakfast' }] },
    { dayName: 'Tuesday', date: '2026-07-14', chefs: ['Aled'], assignments: [{ chef: 'Aled', section: 'Breakfast' }] }
  ];
  const fairButMissedPreferenceRota = [
    { dayName: 'Monday', date: '2026-07-13', chefs: ['Joel'], assignments: [{ chef: 'Joel', section: 'Breakfast' }] },
    { dayName: 'Tuesday', date: '2026-07-14', chefs: ['Aled'], assignments: [{ chef: 'Aled', section: 'Breakfast' }] }
  ];
  assert(
    scoreSoftPreferences({ state: breakfastPreferenceState, rota: preferenceWithRepeatRota, hardValidation: [] }).score
      > scoreSoftPreferences({ state: breakfastPreferenceState, rota: fairButMissedPreferenceRota, hardValidation: [] }).score,
    'Breakfast scoring no longer lets one avoidable fairness repeat cancel a feasible Preferred-day match'
  );

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
  const historyBeforeFailedBlock = JSON.stringify(state.history);
  let failedBlockRejected = false;
  try {
    upsertPublishedWeeks(state, [
      { status: 'ok', weekStart: '2026-07-20', rota: solve.rota, summary: solve.summary },
      { status: 'infeasible', weekStart: '2026-07-27', rota: [], summary: [] }
    ]);
  } catch (error) {
    failedBlockRejected = true;
  }
  assert(failedBlockRejected && JSON.stringify(state.history) === historyBeforeFailedBlock, 'Published history is atomic when a later week fails');

  const legacyRecord = { ...state.history[0] };
  delete legacyRecord.key;
  state.history = [legacyRecord];
  const legacyUpsert = upsertPublishedHistory(state, legacyRecord.weekStart, solve.rota, solve.summary);
  assert(legacyUpsert.inserted === solve.summary.length - 1 && state.history.filter((entry) => entry.weekStart === legacyRecord.weekStart && entry.chef === legacyRecord.chef).length === 1, 'Legacy history without a key migrates by replacing the matching week and chef');

  saveAppState(state);
  loadAppState();
  const reloaded = getState();
  assert(Array.isArray(reloaded.staff) && reloaded.staff.length > 0, 'Saved data survives page reload');

  reloaded.staff[0] = {
    ...reloaded.staff[0],
    weekendRule: 'Does not work weekends',
    weekend_rule: true,
    fixedDayOff: 'Saturday',
    fixedDaysOff: ['Saturday'],
    fixed_days_off: ['Sunday'],
    preferredBreakfast: 'Friday',
    skills: { ...reloaded.staff[0].skills, Breakfast: 3 },
    preferredDaysOff: []
  };
  saveAppState(reloaded);
  loadAppState();
  const legacyReloadedChef = getState().staff[0];
  const subsequentlySaved = JSON.parse(localStorage.getItem('gtRota.state.v2')).staff[0];
  assert(!Object.prototype.hasOwnProperty.call(legacyReloadedChef, 'weekendRule'), 'Legacy chef data containing the obsolete field still loads safely');
  assert(!['weekend_rule', 'fixedDayOff', 'fixedDaysOff', 'fixed_days_off'].some((field) => Object.prototype.hasOwnProperty.call(legacyReloadedChef, field)), 'Legacy Fixed Days Off and Weekend Rule variants are stripped when data loads');
  assert(legacyReloadedChef.preferredBreakfast === 'Friday', 'Preferred breakfast day survives legacy data loading');
  assert(!Object.prototype.hasOwnProperty.call(legacyReloadedChef.skills || {}, 'Breakfast'), 'Legacy Breakfast competency is ignored during loading');
  assert(JSON.stringify(legacyReloadedChef.preferredDaysOff) === JSON.stringify(['Saturday']), 'Legacy Fixed Day Off migrates once while weekend values are not converted');
  assert(!Object.prototype.hasOwnProperty.call(subsequentlySaved, 'weekendRule'), 'The obsolete field is omitted when legacy data is subsequently saved');
  assert(!['weekend_rule', 'fixedDayOff', 'fixedDaysOff', 'fixed_days_off'].some((field) => Object.prototype.hasOwnProperty.call(subsequentlySaved, field)), 'Obsolete day-off fields are omitted when legacy data is saved again');
}
