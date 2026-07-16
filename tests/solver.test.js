import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import {
  buildRota,
  buildMultiWeekRota,
  createFairnessState,
  FAIRNESS_DAY_WEIGHTS,
  getEmptyFairnessRecord,
  getFairnessPenalty
} from '../js/solver.js';
import { isSenior, getHoursForDay, getHoursForAssignment } from '../js/scoring.js';
import { validateRotaHardRules } from '../js/validation.js?v=20260714';

function setupBaseState() {
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
  state.weeklyInputs.availability = [];
  state.weeklyInputs.dailyOverrides = {};
  state.weeklyInputs.additionalChefRequirements = [];
  state.weeklyInputs.numWeeks = 4;
  syncCompatibilityViews();
  return state;
}

function runScenario(state, override = {}, options = {}) {
  return buildRota({
    weekStart: override.weekStart ?? state.weeklyInputs.weekStart,
    mioChef: override.mioChef ?? state.weeklyInputs.mioChef,
    mioSelectionsByWeek: override.mioSelectionsByWeek ?? state.weeklyInputs.mioSelectionsByWeek,
    additionalChefRequirements: override.additionalChefRequirements ?? (state.weeklyInputs.additionalChefRequirements || []),
    availability: override.availability ?? state.weeklyInputs.availability
  }, options);
}

function getHardFailures(state, result, inputs = state.weeklyInputs) {
  const hard = validateRotaHardRules({ rota: result.rota, state, inputs, summary: result.summary });
  return hard.filter((item) => !item.passed);
}

function getMioSummary(weekResult, chefName) {
  return weekResult.summary.find((item) => item.name === chefName);
}

export async function runSolverTests(assert) {
  const state = setupBaseState();
  const baseline = runScenario(state);
  const baselineFailures = getHardFailures(state, baseline, { ...state.weeklyInputs, mioChef: 'Dan' });

  assert(baseline.status === 'ok', 'Baseline week with Dan on MIO is feasible');
  assert(baselineFailures.length === 0, 'Baseline week has no hard-rule failures');
  assert((getMioSummary(baseline, 'Dan')?.mioDays || 0) === 3, 'Selected MIO chef receives exactly 3 MIO shifts in baseline');
  assert((getMioSummary(baseline, 'Dan')?.gtDays || 0) === 2, 'Selected MIO chef receives exactly 2 GT shifts in baseline');
  assert(
    baseline.rota
      .filter((day) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName))
      .every((day) => {
        const pass = day.assignments.find((assignment) => assignment.section === 'Pass');
        const passChef = state.staff.find((staff) => staff.name === pass?.chef);
        return !!passChef && isSenior(passChef);
      }),
    'Baseline uses senior chef on Pass Thursday-Sunday where feasible'
  );

  const multiWeek = buildMultiWeekRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    mioSelectionsByWeek: state.weeklyInputs.mioSelectionsByWeek,
    additionalChefRequirements: [],
    availability: []
  }, 4);

  assert(multiWeek.status === 'ok', 'Multi-week: four selected weeks are all feasible');
  assert(multiWeek.weeks.length === 4, 'Multi-week: four-week generation returns four published weeks');
  multiWeek.weeks.forEach((weekResult, index) => {
    const inputs = { ...state.weeklyInputs, weekStart: weekResult.weekStart, mioChef: weekResult.mioChef };
    const hardFailures = getHardFailures(state, weekResult, inputs);
    assert(hardFailures.length === 0, `Multi-week: week ${index + 1} has no hard-rule failures`);
  });

  const week1 = multiWeek.weeks[0];
  const week2 = multiWeek.weeks[1];
  assert(week1.mioChef === 'Dan' && week2.mioChef === 'Fred', 'Different MIO chefs can be selected for different weeks');
  assert((getMioSummary(week1, 'Dan')?.mioDays || 0) === 3, 'Week 1 uses the selected Week 1 MIO chef');
  assert((getMioSummary(week2, 'Fred')?.mioDays || 0) === 3, 'Week 2 uses the selected Week 2 MIO chef');
  assert((getMioSummary(week2, 'Dan')?.mioDays || 0) === 0, 'Week 2 does not inherit Week 1 MIO chef accidentally');

  const fairnessState = createFairnessState(state.staff);
  fairnessState.Dan = {
    ...getEmptyFairnessRecord(),
    weightedBurden: FAIRNESS_DAY_WEIGHTS.Friday + FAIRNESS_DAY_WEIGHTS.Saturday + FAIRNESS_DAY_WEIGHTS.Sunday,
    fridayCount: 1,
    saturdayCount: 1,
    sundayCount: 1
  };
  const wednesdayPenalty = getFairnessPenalty({ chefName: 'Dan', dayName: 'Wednesday', fairnessState });
  const fridayPenalty = getFairnessPenalty({ chefName: 'Dan', dayName: 'Friday', fairnessState });
  const sundayPenalty = getFairnessPenalty({ chefName: 'Dan', dayName: 'Sunday', fairnessState });
  assert(wednesdayPenalty < fridayPenalty && fridayPenalty < sundayPenalty, 'Friday/Saturday/Sunday weights affect tie-breaking penalties');

  const repeatedWeekendPenalty = getFairnessPenalty({
    chefName: 'Dan',
    dayName: 'Sunday',
    fairnessState: {
      Dan: {
        ...getEmptyFairnessRecord(),
        lastSaturdaySundayPair: true,
        repeatedSaturdaySundayPairs: 1
      }
    },
    currentWeekAttendance: {
      Dan: { days: ['Saturday'], workedFriday: false, workedSaturday: true, workedSunday: false }
    }
  });
  const freshWeekendPenalty = getFairnessPenalty({
    chefName: 'Dan',
    dayName: 'Sunday',
    fairnessState: { Dan: getEmptyFairnessRecord() },
    currentWeekAttendance: {
      Dan: { days: ['Saturday'], workedFriday: false, workedSaturday: true, workedSunday: false }
    }
  });
  assert(repeatedWeekendPenalty > freshWeekendPenalty, 'Repeated weekends receive a penalty');

  const oneWeekWithoutFairness = runScenario(state);
  const oneWeekWithDisabledFairness = runScenario(state, {}, {
    fairnessEnabled: false,
    fairnessState: {
      Dan: { ...getEmptyFairnessRecord(), weightedBurden: 999, fridayCount: 99, saturdayCount: 99, sundayCount: 99 }
    }
  });
  assert(
    JSON.stringify(oneWeekWithoutFairness.rota) === JSON.stringify(oneWeekWithDisabledFairness.rota),
    'Fairness has no effect in one-week mode'
  );

  const sectionQualityScenario = setupBaseState();
  const highPenalty = createFairnessState(sectionQualityScenario.staff);
  highPenalty.Joel = {
    ...getEmptyFairnessRecord(),
    weightedBurden: 999,
    fridayCount: 10,
    saturdayCount: 10,
    sundayCount: 10
  };
  const qualityResult = runScenario(sectionQualityScenario, {}, { fairnessEnabled: true, fairnessState: highPenalty });
  const wednesdaySauce = qualityResult.rota.find((day) => day.dayName === 'Wednesday')?.assignments.find((assignment) => assignment.section === 'Sauce');
  const wednesdaySauceChef = sectionQualityScenario.staff.find((staff) => staff.name === wednesdaySauce?.chef);
  assert((wednesdaySauceChef?.skills?.Sauce || 0) === 3, 'Section quality beats fairness');

  assert(getHoursForDay('Wednesday') === 12.5, 'Wednesday normal shift equals 12.5 hours');
  assert(getHoursForDay('Sunday') === 10.5, 'Sunday normal shift equals 10.5 hours');
  assert(getHoursForAssignment('Monday', 'MIO') === 8.5, 'MIO shift equals 8.5 hours');

  const infeasibleState = setupBaseState();
  infeasibleState.weeklyInputs.availability = [
    { chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-20', finishDate: '2026-07-23', notes: '' }
  ];
  syncCompatibilityViews();
  const infeasibleMultiWeek = buildMultiWeekRota({
    weekStart: infeasibleState.weeklyInputs.weekStart,
    mioChef: infeasibleState.weeklyInputs.mioChef,
    mioSelectionsByWeek: infeasibleState.weeklyInputs.mioSelectionsByWeek,
    additionalChefRequirements: [],
    availability: infeasibleState.weeklyInputs.availability
  }, 4);
  assert(infeasibleMultiWeek.status === 'infeasible', 'Any infeasible week makes the entire result infeasible');
  assert(infeasibleMultiWeek.failedWeek === 2, 'Failed week number is reported');
  assert(infeasibleMultiWeek.failedWeekStart === '2026-07-20', 'Failed week start is reported');
  assert(infeasibleMultiWeek.weeks.length === 1, 'Generation stops immediately after the first infeasible week');
}
