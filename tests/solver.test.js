import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import {
  SOLVER_SEARCH_LIMITS,
  buildRota,
  buildMultiWeekRota,
  cloneRotaCandidate,
  compareCompleteRotaCandidates,
  compareFairnessTieBreak,
  generateNeighborCandidates,
  getSectionCandidateBaseScore,
  hardValidateRotaCandidate,
  optimizeBreakfastAssignments,
  optimizeRotaCandidate,
  repairExactGtTargetsWithFloat,
  selectBreakfastChef
} from '../js/solver.js?v=20260719s';
import { isSenior, getHoursForDay, getHoursForAssignment, scoreSoftPreferences } from '../js/scoring.js';
import { getCoreSections, isUnavailable, validateRotaHardRules, validateRotaSoftRules } from '../js/validation.js?v=20260719s';
import { canCoverSection, sectionCandidateScore } from '../js/section-levels.js';
import { normalizeChefRecord } from '../js/staff.js';
import { getGtChefNamesForDay, getGtDaysByChef, getVisibleGtChefDayTotal } from '../js/rota-model.js';

const PRIMARY_GT_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry', 'Float'];

function setupBaseState() {
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = '2026-07-13';
  state.weeklyInputs.mioChef = 'Dan';
  state.weeklyInputs.availability = [];
  state.weeklyInputs.dailyOverrides = {};
  state.weeklyInputs.additionalChefRequirements = [];
  syncCompatibilityViews();
  return state;
}

function runScenario(state, override = {}) {
  return buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: override.mioChef ?? state.weeklyInputs.mioChef,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements || [],
    availability: state.weeklyInputs.availability
  });
}

function getHardFailures(state, result) {
  const hard = validateRotaHardRules({ rota: result.rota, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  return hard.filter((item) => !item.passed);
}

function hasAnyAssignment(result, chefName) {
  return result.rota.some((day) => day.assignments.some((assignment) => assignment.chef === chefName));
}

function getPrimaryAssignments(day, chefName) {
  return day.assignments.filter((assignment) => assignment.chef === chefName && PRIMARY_GT_SECTIONS.includes(assignment.section));
}

function createTestChef(name, role, skills = {}, extra = {}) {
  return {
    id: `test-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    role,
    senior: false,
    breakfastEligible: true,
    mioEligible: false,
    preferredDaysOff: [],
    notes: '',
    skills: {
      Pass: 0,
      Sauce: 0,
      Garnish: 0,
      Larder: 0,
      Pastry: 0,
      ...skills
    },
    ...extra
  };
}

export async function runSolverTests(assert) {
  const state = setupBaseState();

  const baseline = runScenario(state);
  const baselineFailures = getHardFailures(state, baseline);

  assert(state.weeklyInputs.availability.length === 0, 'Fresh and reset state contains no example annual leave or unavailability');
  assert(baseline.status === 'ok', 'Baseline week with Dan on MIO is feasible');
  assert(baselineFailures.length === 0, 'Baseline week has no hard-rule failures');
  assert(
    baseline.optimizationDiagnostics?.candidateRotasEvaluated >= 1
      && baseline.optimizationDiagnostics.candidateRotasEvaluated <= SOLVER_SEARCH_LIMITS.singleWeek.initialCandidateCount,
    'Whole-rota optimization evaluates a bounded set of hard-valid initial candidates'
  );
  assert(
    baseline.optimizationDiagnostics?.winningCandidateIterations <= SOLVER_SEARCH_LIMITS.singleWeek.maxOptimizationIterations,
    'Whole-rota optimization terminates within its configured iteration limit'
  );
  assert(
    baseline.optimizationDiagnostics?.finalPreferredDayOffViolationCount
      <= baseline.optimizationDiagnostics?.initialPreferredDayOffViolationCount,
    'Whole-rota optimization never accepts more Preferred Day Off violations to improve a lower-priority metric'
  );
  const clonedBaseline = cloneRotaCandidate(baseline.rota);
  clonedBaseline[0].chefs.push('Synthetic mutation');
  assert(!baseline.rota[0].chefs.includes('Synthetic mutation'), 'Rota candidate cloning is deep for day chef and assignment arrays');

  const deterministicBaseline = runScenario(state);
  assert(
    JSON.stringify(deterministicBaseline.rota) === JSON.stringify(baseline.rota)
      && deterministicBaseline.optimizationDiagnostics.finalSoftScore === baseline.optimizationDiagnostics.finalSoftScore,
    'Whole-rota optimization is deterministic for identical inputs'
  );
  const aledWeekendDays = baseline.rota
    .filter((day) => ['Saturday', 'Sunday'].includes(day.dayName) && day.chefs.includes('Aled'))
    .map((day) => day.dayName);
  const baselineSoftCompromises = validateRotaSoftRules({ rota: baseline.rota, state, inputs: state.weeklyInputs });
  assert(aledWeekendDays.length === 0, 'Regression: whole-week search moves Aled off both preferred weekend days when a valid reallocation exists');
  assert(
    !baselineSoftCompromises.some((result) => result.ruleId === 'S002' && result.message.includes('Aled') && /Saturday|Sunday/.test(result.message)),
    'Regression: avoidable Aled weekend compromises are not reported after optimization'
  );
  const danBaseline = baseline.summary.find((item) => item.name === 'Dan');
  assert((danBaseline?.mioDays || 0) === 3, 'Selected MIO chef receives exactly 3 MIO shifts in baseline');
  assert((danBaseline?.gtDays || 0) === 2, 'Selected MIO chef receives exactly 2 GT shifts in baseline');
  const danMioGtOverlap = baseline.rota.some((day) => day.chefs.includes('Dan') && day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === 'Dan'));
  assert(!danMioGtOverlap, 'Selected MIO chef is never assigned MIO and GT on the same day');
  const danWeekendGt = baseline.rota
    .filter((day) => ['Saturday', 'Sunday'].includes(day.dayName))
    .every((day) => day.chefs.includes('Dan'));
  assert(danWeekendGt, 'Selected MIO chef is preferentially assigned to weekend GT days when available');

  const noMioInputs = {
    weekStart: state.weeklyInputs.weekStart,
    mioChef: '',
    additionalChefRequirements: [],
    availability: []
  };
  const noMioResult = buildRota(noMioInputs);
  const noMioHardValidation = validateRotaHardRules({
    rota: noMioResult.rota,
    state,
    inputs: noMioInputs,
    summary: noMioResult.summary,
    fullWeekDates: noMioResult.fullWeekDates
  });
  assert(noMioResult.status === 'ok', 'No MIO chef: a one-week rota remains feasible');
  assert(!noMioResult.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'MIO')), 'No MIO chef: no MIO assignments or placeholders are created');
  assert(noMioResult.summary.every((item) => item.gtDays === 4 && item.adjustedGtTarget === 4), 'No MIO chef: every chef uses the normal four-day GT target when there is no leave');
  assert(noMioHardValidation.every((result) => result.passed), 'No MIO chef: ordinary GT and exact-target hard rules remain valid');
  assert(noMioHardValidation.some((result) => result.ruleId === 'H032' && result.message.includes('MIO chef: None')), 'No MIO chef: technical validation records the intentional None configuration');
  assert(!noMioHardValidation.some((result) => ['H015', 'H021', 'H022', 'H023'].includes(result.ruleId) && result.passed === false), 'No MIO chef: selected-MIO pattern checks do not fail');

  const noMioLeaveInputs = {
    ...noMioInputs,
    availability: [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }]
  };
  const noMioLeaveResult = buildRota(noMioLeaveInputs);
  const noMioFredSummary = noMioLeaveResult.summary.find((item) => item.name === 'Fred');
  assert(noMioLeaveResult.status === 'ok' && noMioFredSummary?.gtDays === 3 && noMioFredSummary?.adjustedGtTarget === 3, 'No MIO chef: annual leave still reduces the normal GT target');
  assert(noMioLeaveResult.summary.filter((item) => item.name !== 'Fred').every((item) => item.gtDays === 4 && item.adjustedGtTarget === 4), 'No MIO chef: other chefs retain their normal GT targets alongside leave adjustments');
  ['Aled', 'Charlie', 'Connor'].forEach((name) => {
    const chef = createTestChef(name, 'Sous Chef', { Sauce: 2 });
    assert(!isUnavailable(chef, '2026-07-14', 'Tuesday', { _availability: [] }) && !isUnavailable(chef, '2026-07-19', 'Sunday', { _availability: [] }), `${name} receives no name-specific weekday or weekend exclusion`);
  });

  const monWedExact4 = baseline.rota
    .filter((day) => ['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName))
    .every((day) => new Set(day.chefs).size === 4);
  assert(monWedExact4, 'Baseline has exactly four GT chefs Monday-Wednesday');

  const passSeniorFeasible = baseline.rota
    .filter((day) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .every((day) => {
      const pass = day.assignments.find((assignment) => assignment.section === 'Pass');
      if (!pass) return false;
      const passChef = state.staff.find((staff) => staff.name === pass.chef);
      return !!passChef && isSenior(passChef);
    });
  assert(passSeniorFeasible, 'Baseline uses senior chef on Pass Thursday-Sunday where feasible');

  const baselineNonMioExactTargets = baseline.summary
    .filter((item) => item.name !== 'Dan')
    .every((item) => item.gtDays === item.adjustedGtTarget && item.adjustedGtTarget === 4);
  assert(baselineNonMioExactTargets, 'Baseline week gives every non-MIO chef exactly 4 GT days');

  assert(
    baseline.rota.every((day) => {
      const breakfast = day.assignments.find((assignment) => assignment.section === 'Breakfast');
      const chef = state.staff.find((candidate) => candidate.name === breakfast?.chef);
      return chef?.breakfastEligible === true && !Object.prototype.hasOwnProperty.call(chef.skills || {}, 'Breakfast');
    }),
    'Breakfast-eligible chefs can cover Breakfast without a competency value'
  );

  const breakfastIneligibleState = setupBaseState();
  breakfastIneligibleState.staff.find((chef) => chef.name === 'Aled').breakfastEligible = false;
  const breakfastIneligibleResult = runScenario(breakfastIneligibleState);
  assert(
    breakfastIneligibleResult.rota.every((day) => !day.assignments.some((assignment) => assignment.section === 'Breakfast' && assignment.chef === 'Aled')),
    'Breakfast-ineligible chefs are never assigned Breakfast'
  );

  const preferredBreakfastState = setupBaseState();
  const tiedBreakfastCandidates = [
    { ...preferredBreakfastState.staff[0], preferredBreakfast: '' },
    { ...preferredBreakfastState.staff[1], preferredBreakfast: 'Monday' }
  ];
  assert(
    selectBreakfastChef(tiedBreakfastCandidates, 'Monday', {})?.name === tiedBreakfastCandidates[1].name,
    'A matching Preferred breakfast day wins when otherwise-valid candidates are tied'
  );
  assert(
    selectBreakfastChef(tiedBreakfastCandidates, 'Monday', { [tiedBreakfastCandidates[1].name]: 1 })?.name === tiedBreakfastCandidates[1].name,
    'A feasible Preferred breakfast day takes priority over a Breakfast repeat'
  );
  assert(
    selectBreakfastChef(tiedBreakfastCandidates.map((chef) => ({ ...chef, preferredBreakfast: '' })), 'Monday', { [tiedBreakfastCandidates[0].name]: 1 })?.name === tiedBreakfastCandidates[1].name,
    'Breakfast rotation still breaks ties when no candidate has a matching preference'
  );

  preferredBreakfastState.staff.forEach((chef) => {
    chef.preferredBreakfast = 'Sunday';
  });
  const mismatchedBreakfastPreferenceResult = runScenario(preferredBreakfastState);
  assert(
    mismatchedBreakfastPreferenceResult.status === 'ok' && getHardFailures(preferredBreakfastState, mismatchedBreakfastPreferenceResult).length === 0,
    'Preferred breakfast day remains soft and cannot make a valid rota infeasible'
  );

  const breakfastSwapState = setupBaseState();
  breakfastSwapState.staff.find((chef) => chef.name === 'Charlie').preferredBreakfast = 'Sunday';
  breakfastSwapState.staff.find((chef) => chef.name === 'Charlie').skills.Breakfast = 0;
  breakfastSwapState.staff.find((chef) => chef.name === 'Joel').skills.Breakfast = 99;
  breakfastSwapState.weeklyInputs.availability = ['Charlie', 'Joel'].map((chef) => ({
    chef,
    type: 'Unavailable',
    startDate: '2026-07-13',
    finishDate: '2026-07-15',
    notes: 'Regression setup: forces Thursday-Sunday GT availability'
  }));
  syncCompatibilityViews();
  const breakfastSwapBase = runScenario(breakfastSwapState);
  const breakfastSwapCompeting = cloneRotaCandidate(breakfastSwapBase.rota);
  const forcedBreakfastByDay = { Thursday: 'Charlie', Sunday: 'Joel' };
  const orderedBreakfastDays = breakfastSwapCompeting
    .slice()
    .sort((a, b) => {
      const forcedA = Object.prototype.hasOwnProperty.call(forcedBreakfastByDay, a.dayName) ? 0 : 1;
      const forcedB = Object.prototype.hasOwnProperty.call(forcedBreakfastByDay, b.dayName) ? 0 : 1;
      return forcedA - forcedB || a.date.localeCompare(b.date);
    });
  const distinctBreakfastPlan = {};
  const usedBreakfastChefs = new Set();
  function findDistinctBreakfastPlan(dayIndex) {
    if (dayIndex === orderedBreakfastDays.length) return true;
    const day = orderedBreakfastDays[dayIndex];
    const forcedChef = forcedBreakfastByDay[day.dayName];
    const candidates = day.assignments
      .filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section))
      .map((assignment) => assignment.chef)
      .filter((name) => breakfastSwapState.staff.find((chef) => chef.name === name)?.breakfastEligible === true)
      .filter((name) => !forcedChef || name === forcedChef)
      .sort();
    for (const chefName of candidates) {
      if (usedBreakfastChefs.has(chefName)) continue;
      usedBreakfastChefs.add(chefName);
      distinctBreakfastPlan[day.dayName] = chefName;
      if (findDistinctBreakfastPlan(dayIndex + 1)) return true;
      usedBreakfastChefs.delete(chefName);
      delete distinctBreakfastPlan[day.dayName];
    }
    return false;
  }
  const hasDistinctCompetingPlan = findDistinctBreakfastPlan(0);
  if (hasDistinctCompetingPlan) {
    breakfastSwapCompeting.forEach((day) => {
      day.assignments.find((assignment) => assignment.section === 'Breakfast').chef = distinctBreakfastPlan[day.dayName];
    });
  }
  const competingBreakfastHard = hardValidateRotaCandidate({
    rota: breakfastSwapCompeting,
    state: breakfastSwapState,
    inputs: breakfastSwapState.weeklyInputs,
    fullWeekDates: breakfastSwapBase.fullWeekDates
  });
  const optimizedBreakfastSwap = optimizeBreakfastAssignments({
    rota: breakfastSwapCompeting,
    state: breakfastSwapState
  });
  const optimizedBreakfastHard = hardValidateRotaCandidate({
    rota: optimizedBreakfastSwap.rota,
    state: breakfastSwapState,
    inputs: breakfastSwapState.weeklyInputs,
    fullWeekDates: breakfastSwapBase.fullWeekDates
  });
  const optimizedThursdayBreakfast = optimizedBreakfastSwap.rota
    .find((day) => day.dayName === 'Thursday')?.assignments
    .find((assignment) => assignment.section === 'Breakfast')?.chef;
  const optimizedSundayBreakfast = optimizedBreakfastSwap.rota
    .find((day) => day.dayName === 'Sunday')?.assignments
    .find((assignment) => assignment.section === 'Breakfast')?.chef;
  assert(
    breakfastSwapBase.status === 'ok'
      && hasDistinctCompetingPlan
      && competingBreakfastHard.valid,
    'Breakfast regression setup is a hard-valid week with Charlie and Joel working Thursday-Sunday'
  );
  assert(
    optimizedSundayBreakfast === 'Charlie' && optimizedThursdayBreakfast === 'Joel',
    'Regression: whole-week Breakfast optimization swaps Joel to Thursday and gives Charlie preferred Sunday'
  );
  assert(
    optimizedBreakfastSwap.preferenceScoreAfter > optimizedBreakfastSwap.preferenceScoreBefore
      && optimizedBreakfastSwap.fairnessRepeatsAfter <= optimizedBreakfastSwap.fairnessRepeatsBefore,
    'Breakfast rearrangement improves total preference satisfaction without worsening rotation fairness'
  );
  assert(
    optimizedBreakfastHard.valid && optimizedBreakfastHard.hardValidation.every((result) => result.passed),
    'Breakfast preference optimization preserves every hard rota rule'
  );
  assert(
    optimizedBreakfastSwap.rota.every((day) => {
      const breakfasts = day.assignments.filter((assignment) => assignment.section === 'Breakfast');
      const breakfastChef = breakfasts[0]?.chef;
      return breakfasts.length === 1
        && day.chefs.includes(breakfastChef)
        && day.assignments.some((assignment) => assignment.chef === breakfastChef && PRIMARY_GT_SECTIONS.includes(assignment.section));
    }),
    'Breakfast optimization keeps exactly one working GT chef assigned per day'
  );
  assert(
    optimizedSundayBreakfast === 'Charlie'
      && breakfastSwapState.staff.find((chef) => chef.name === 'Charlie').skills.Breakfast === 0
      && breakfastSwapState.staff.find((chef) => chef.name === 'Joel').skills.Breakfast === 99,
    'Breakfast eligibility remains boolean and ignores legacy competency weighting'
  );

  const infeasibleBreakfastPreferenceState = setupBaseState();
  infeasibleBreakfastPreferenceState.staff.find((chef) => chef.name === 'Charlie').preferredBreakfast = 'Sunday';
  infeasibleBreakfastPreferenceState.weeklyInputs.availability = [{
    chef: 'Charlie',
    type: 'Unavailable',
    startDate: '2026-07-19',
    finishDate: '2026-07-19',
    notes: 'Preferred Breakfast day is genuinely infeasible'
  }];
  syncCompatibilityViews();
  const infeasibleBreakfastPreference = runScenario(infeasibleBreakfastPreferenceState);
  const infeasibleSundayBreakfast = infeasibleBreakfastPreference.rota
    .find((day) => day.dayName === 'Sunday')?.assignments
    .find((assignment) => assignment.section === 'Breakfast')?.chef;
  assert(
    infeasibleBreakfastPreference.status === 'ok'
      && infeasibleSundayBreakfast !== 'Charlie'
      && getHardFailures(infeasibleBreakfastPreferenceState, infeasibleBreakfastPreference).length === 0,
    'A Preferred breakfast day may be missed when that chef cannot feasibly work it'
  );

  const baselineFloatAssignments = baseline.rota.flatMap((day) => day.assignments
    .filter((assignment) => assignment.section === 'Float')
    .map((assignment) => ({ ...assignment, day })));
  assert(baselineFloatAssignments.length >= 6, 'Baseline capacity uses explicit Float assignments to fill weekly GT targets');
  assert(baselineFloatAssignments.some((entry, index) => baselineFloatAssignments.filter((other) => other.day.date === entry.day.date).length > 1), 'Multiple Float chefs can be assigned on the same day when needed');
  assert(baseline.rota
    .filter((day) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .every((day) => day.chefs.length >= 5), 'Thursday-Sunday schedules at least five GT chefs');
  assert(baselineFloatAssignments.every(({ chef, day }) => day.chefs.includes(chef)), 'Every Float chef appears in day.chefs');
  assert(baselineFloatAssignments.every(({ chef, day }) => getPrimaryAssignments(day, chef).length === 1), 'A Float chef has exactly one primary GT assignment on that day');
  assert(baseline.summary
    .filter((item) => item.floatDays > 0)
    .every((item) => item.gtHours === item.gtDays * getHoursForDay('Thursday', false) || item.gtHours > 0), 'Float days contribute to GT hours in the weekly summary');

  const floatRepairState = setupBaseState();
  floatRepairState.staff = floatRepairState.staff.filter((chef) => ['Charlie', 'Joel'].includes(chef.name));
  const repairDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((dayName, index) => ({
    dayName,
    date: `2026-07-${String(13 + index).padStart(2, '0')}`,
    chefs: [],
    assignments: []
  }));
  ['Thursday', 'Friday', 'Sunday'].forEach((dayName) => {
    repairDays.find((day) => day.dayName === dayName).assignments.push({ chef: 'Joel', section: 'Float' });
  });
  ['Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((dayName) => {
    repairDays.find((day) => day.dayName === dayName).assignments.push({ chef: 'Charlie', section: 'Float' });
  });
  const repairs = repairExactGtTargetsWithFloat({
    rota: repairDays,
    state: floatRepairState,
    inputs: { weekStart: '2026-07-13', mioChef: '' },
    gtTargetsByChef: { Charlie: 4, Joel: 4 },
    ruleOverrides: { _availability: [] }
  });
  const repairedSaturdayFloat = repairDays.find((day) => day.dayName === 'Saturday').assignments
    .filter((assignment) => assignment.section === 'Float')
    .map((assignment) => assignment.chef);
  const repairedCounts = getGtDaysByChef(repairDays);
  assert(repairs.some((repair) => repair.chef === 'Joel' && repair.date === '2026-07-18'), 'Float target repair: Joel is automatically added on the only available fourth GT day');
  assert(JSON.stringify(repairedSaturdayFloat) === JSON.stringify(['Charlie', 'Joel']), 'Float target repair: Charlie remains on Saturday Float when Joel is appended');
  assert(repairedCounts.Charlie === 4 && repairedCounts.Joel === 4, 'Float target repair: both Charlie and Joel finish on exactly four unique GT dates');
  assert(repairDays.every((day) => new Set(day.assignments.filter((assignment) => assignment.section === 'Float').map((assignment) => assignment.chef)).size === day.assignments.filter((assignment) => assignment.section === 'Float').length), 'Float target repair: automatic repair never duplicates a chef within one Float cell');

  const joelLeaveState = setupBaseState();
  joelLeaveState.weeklyInputs.availability = [{ chef: 'Joel', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const joelLeave = runScenario(joelLeaveState);
  const joelLeaveFailures = getHardFailures(joelLeaveState, joelLeave);
  const joelSummary = joelLeave.summary.find((item) => item.name === 'Joel');
  assert(joelLeave.status === 'ok', 'Joel full-week annual leave scenario is feasible');
  assert((joelSummary?.annualLeaveHours || 0) === 48, 'Joel receives 48 leave-credit hours for full leave week');
  assert(!hasAnyAssignment(joelLeave, 'Joel'), 'Joel has no GT or MIO assignment during full leave week');
  assert(joelLeaveFailures.length === 0, 'Joel full-week leave scenario has no hard failures');

  const charlieLeaveState = setupBaseState();
  charlieLeaveState.weeklyInputs.availability = [{ chef: 'Charlie', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const charlieLeave = runScenario(charlieLeaveState);
  const charlieLeaveFailures = getHardFailures(charlieLeaveState, charlieLeave);
  const charlieSummary = charlieLeave.summary.find((item) => item.name === 'Charlie');
  const dailySeniorCover = charlieLeave.rota.every((day) => day.chefs.some((name) => isSenior(charlieLeaveState.staff.find((staff) => staff.name === name))));
  assert(charlieLeave.status === 'ok', 'Charlie full-week annual leave scenario is feasible');
  assert((charlieSummary?.annualLeaveHours || 0) === 48, 'Charlie receives 48 leave-credit hours for full leave week');
  assert(dailySeniorCover, 'Every day retains senior cover when Charlie is on leave');
  assert(charlieLeaveFailures.length === 0, 'Charlie full-week leave scenario has no hard failures');

  const aledWeekendRequiredState = setupBaseState();
  aledWeekendRequiredState.weeklyInputs.availability = [
    { chef: 'Charlie', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-19', notes: '' },
    { chef: 'Adam', type: 'Unavailable', startDate: '2026-07-18', finishDate: '2026-07-18', notes: '' },
    { chef: 'Connor', type: 'Unavailable', startDate: '2026-07-18', finishDate: '2026-07-18', notes: '' }
  ];
  const aledWeekendRequired = runScenario(aledWeekendRequiredState);
  const saturdayRequired = aledWeekendRequired.rota.find((day) => day.dayName === 'Saturday');
  assert(aledWeekendRequired.status === 'ok' && saturdayRequired?.chefs.includes('Aled'), 'Aled remains schedulable on Saturday when senior coverage requires it');
  assert(
    validateRotaSoftRules({ rota: aledWeekendRequired.rota, state: aledWeekendRequiredState, inputs: aledWeekendRequiredState.weeklyInputs })
      .some((result) => result.ruleId === 'S002' && result.message.includes('Aled') && result.message.includes('Saturday')),
    'A genuinely unavoidable Preferred Day Off breach is still reported after optimization'
  );
  assert(
    aledWeekendRequired.softScore.preferredDayOffViolationCount > 0
      && getHardFailures(aledWeekendRequiredState, aledWeekendRequired).length === 0,
    'Preferred Days Off remain soft and may be broken when hard-valid senior coverage requires it'
  );

  const fredAnnualLeaveState = setupBaseState();
  fredAnnualLeaveState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }];
  syncCompatibilityViews();
  const fredAnnualLeave = runScenario(fredAnnualLeaveState);
  const fredAnnualLeaveSummary = fredAnnualLeave.summary.find((item) => item.name === 'Fred');
  assert(fredAnnualLeave.status === 'ok', 'One annual-leave day still allows an exact weekly GT solution when feasible');
  assert((fredAnnualLeaveSummary?.adjustedGtTarget || 0) === 3, 'One annual-leave day reduces a normal chef GT target from four to three');
  assert((fredAnnualLeaveSummary?.gtDays || 0) === 3, 'Adjusted annual-leave target is met exactly');

  const danUnavailableState = setupBaseState();
  danUnavailableState.weeklyInputs.availability = [{ chef: 'Dan', type: 'Unavailable', startDate: '2026-07-17', finishDate: '2026-07-17', notes: '' }];
  syncCompatibilityViews();
  const danUnavailable = runScenario(danUnavailableState);
  const danUnavailableFailures = getHardFailures(danUnavailableState, danUnavailable);
  const fridayBlocked = !danUnavailable.rota.some((day) => day.dayName === 'Friday' && day.assignments.some((assignment) => assignment.chef === 'Dan'));
  const danAssignedElsewhere = danUnavailable.rota.some((day) => day.dayName !== 'Friday' && day.assignments.some((assignment) => assignment.chef === 'Dan'));
  const danUnavailableSummary = danUnavailable.summary.find((item) => item.name === 'Dan');
  const noMonWedOverstaffing = danUnavailable.rota
    .filter((day) => ['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName))
    .every((day) => new Set(day.chefs).size === 4);
  assert(danUnavailable.status === 'ok', 'Dan Friday unavailable scenario is feasible');
  assert(fridayBlocked, 'Dan is blocked on Friday only when marked unavailable Friday');
  assert(danAssignedElsewhere, 'Dan remains eligible on other valid days when unavailable Friday only');
  assert((danUnavailableSummary?.annualLeaveHours || 0) === 0, 'Unavailable does not create annual-leave credit');
  assert((danUnavailableSummary?.gtDays || 0) === 2, 'Unavailable does not change the selected MIO chef GT target');
  assert(noMonWedOverstaffing, 'Dan unavailable scenario does not overstaff Monday-Wednesday');
  assert(danUnavailableFailures.length === 0, 'Dan Friday unavailable scenario has no hard failures');

  const connorUnavailableState = setupBaseState();
  connorUnavailableState.weeklyInputs.mioChef = '';
  connorUnavailableState.weeklyInputs.availability = [{ chef: 'Connor', type: 'Unavailable', startDate: '2026-07-17', finishDate: '2026-07-17', notes: '' }];
  syncCompatibilityViews();
  const connorUnavailable = runScenario(connorUnavailableState);
  const connorSummary = connorUnavailable.summary.find((item) => item.name === 'Connor');
  assert(connorUnavailable.status === 'ok', 'Normal-chef unavailable scenario remains feasible when other dates exist');
  assert((connorSummary?.gtDays || 0) === 4, 'Unavailable does not reduce a normal chef weekly GT target when the week remains feasible');

  const mylesLeaveState = setupBaseState();
  mylesLeaveState.weeklyInputs.availability = [{ chef: 'Myles', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const mylesLeave = runScenario(mylesLeaveState);
  const mylesLeaveFailures = getHardFailures(mylesLeaveState, mylesLeave);
  const mylesSummary = mylesLeave.summary.find((item) => item.name === 'Myles');
  const mylesAssigned = hasAnyAssignment(mylesLeave, 'Myles');
  assert(mylesLeave.status === 'ok', 'Full-week annual leave reduces a normal chef GT target to zero when cover remains feasible');
  assert((mylesSummary?.annualLeaveHours || 0) === 48, 'Myles receives 48 leave-credit hours for full leave week');
  assert((mylesSummary?.adjustedGtTarget || 0) === 0, 'Full-week annual leave produces a zero GT target');
  assert(!mylesAssigned, 'Myles has no assignment during full-week annual leave');
  assert(mylesLeaveFailures.length === 0, 'Full-week annual leave scenario still passes hard validation when feasible');

  const eligibleMio = state.staff.filter((staff) => staff.mioEligible).map((staff) => staff.name).sort();
  const expectedMio = ['Brooke', 'Camilla', 'Dan', 'Fred', 'Joel'];
  assert(JSON.stringify(eligibleMio) === JSON.stringify(expectedMio), 'Default MIO eligibility is Dan/Fred/Joel/Camilla/Brooke only');
  assert(state.staff.find((chef) => chef.name === 'Myles')?.skills?.Larder === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Myles')?.skills || {}).every(([section, level]) => section === 'Larder' || level === 0), 'Defaults: Myles remains Larder-only');
  assert(state.staff.find((chef) => chef.name === 'Fred')?.skills?.Garnish === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Fred')?.skills || {}).every(([section, level]) => section === 'Garnish' || level === 0), 'Defaults: Fred remains Garnish-only');
  assert(state.staff.find((chef) => chef.name === 'Joel')?.skills?.Sauce === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Joel')?.skills || {}).every(([section, level]) => section === 'Sauce' || level === 0), 'Defaults: Joel remains Sauce-only');
  assert(state.staff.every((chef) => !Object.prototype.hasOwnProperty.call(chef.skills || {}, 'Breakfast')), 'Defaults: Breakfast competency is absent from section skills');
  assert(state.staff.every((chef) => chef.notes === ''), 'Defaults: notes do not duplicate structured section levels');

  const mylesMioAttempt = runScenario(state, { mioChef: 'Myles' });
  const mylesMioAssigned = mylesMioAttempt.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === 'Myles'));
  assert(!mylesMioAssigned, 'Myles cannot be assigned to MIO');
  assert(mylesMioAttempt.status === 'infeasible' && mylesMioAttempt.validation.some((item) => item.message.includes('not eligible for MIO duty')), 'Ineligible selected MIO chef receives a distinct configuration failure');
  assert(mylesMioAttempt.hardValidation?.some((item) => item.ruleId === 'H032' && item.passed === false), 'Ineligible selected MIO chef is distinguished by hard validation');

  const mondayExtraState = setupBaseState();
  mondayExtraState.weeklyInputs.additionalChefRequirements = [{ date: '2026-07-13', count: 1 }];
  const mondayExtra = runScenario(mondayExtraState);
  const mondayPlan = mondayExtra.rota.find((day) => day.dayName === 'Monday');
  assert(mondayExtra.status === 'ok', 'An explicit Monday extra-chef request remains feasible');
  assert((mondayPlan?.chefs.length || 0) === 5, 'Monday to Wednesday adds the exact requested extra GT chef only when explicitly requested');
  assert((mondayPlan?.assignments.filter((assignment) => assignment.section === 'Float').length || 0) === 1, 'An explicit extra Monday chef is shown as Float once core sections are covered');

  const preferredGarnish = createTestChef('Chef A', 'Chef de Partie', { Garnish: 3 });
  const competentGarnish = createTestChef('Chef B', 'Chef de Partie', { Garnish: 2 });
  const garnishCandidates = [preferredGarnish, competentGarnish].sort((a, b) => (
    getSectionCandidateBaseScore({ staff: b, section: 'Garnish', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
    - getSectionCandidateBaseScore({ staff: a, section: 'Garnish', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
  ));
  assert(garnishCandidates[0].name === 'Chef A', 'Scenario A: Preferred candidate outranks otherwise equivalent Competent candidate');

  const competentSauce = createTestChef('Chef A', 'Chef de Partie', { Sauce: 2 });
  const trainingSauce = createTestChef('Chef B', 'Chef de Partie', { Sauce: 1 });
  const sauceCandidates = [competentSauce, trainingSauce].sort((a, b) => (
    getSectionCandidateBaseScore({ staff: b, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
    - getSectionCandidateBaseScore({ staff: a, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
  ));
  assert(sauceCandidates[0].name === 'Chef A', 'Scenario B: Competent candidate outranks otherwise equivalent In training candidate');

  const fairnessConflictCandidates = [createTestChef('Preferred Sauce', 'Chef de Partie', { Sauce: 3 }), createTestChef('Training Sauce', 'Chef de Partie', { Sauce: 1 })];
  const fairnessConflictContext = {
    stats: {
      'Preferred Sauce': { weightedBurden: 8, fridayCount: 1, saturdayCount: 1, sundayCount: 1, repeatedSaturdaySundayPairCount: 0, repeatedFullWeekendCount: 0, repeatedExactPatternCount: 0 },
      'Training Sauce': { weightedBurden: 0, fridayCount: 0, saturdayCount: 0, sundayCount: 0, repeatedSaturdaySundayPairCount: 0, repeatedFullWeekendCount: 0, repeatedExactPatternCount: 0 }
    },
    previousWeekPatterns: {}
  };
  const rankedWithFairness = fairnessConflictCandidates.sort((a, b) => {
    const scoreDiff = getSectionCandidateBaseScore({ staff: b, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
      - getSectionCandidateBaseScore({ staff: a, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' });
    if (scoreDiff !== 0) return scoreDiff;
    return compareFairnessTieBreak(a, b, 'Saturday', fairnessConflictContext, {});
  });
  assert(rankedWithFairness[0].name === 'Preferred Sauce', 'Scenario D: section suitability stays ahead of weekend fairness when levels differ meaningfully');

  const executiveRoleChef = createTestChef('Role A', 'Executive Chef', { Sauce: 2 }, { senior: false });
  const commisRoleChef = createTestChef('Role B', 'Commis Chef', { Sauce: 2 }, { senior: false });
  const executiveRoleScore = getSectionCandidateBaseScore({ staff: executiveRoleChef, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' });
  const commisRoleScore = getSectionCandidateBaseScore({ staff: commisRoleChef, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' });
  assert(executiveRoleScore === commisRoleScore, 'Role display values do not affect solver candidate scoring');
  assert(!isSenior(executiveRoleChef), 'Executive Chef with senior false does not count as senior cover');
  const seniorCommis = createTestChef('Senior Commis', 'Commis Chef', { Sauce: 2 }, { senior: true });
  assert(isSenior(seniorCommis), 'Lower-role chef with senior true counts as senior cover');

  const preferredDaysChef = createTestChef('Preferred Days', 'Chef de Partie', { Sauce: 2 }, { preferredDaysOff: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] });
  const noPreferenceChef = createTestChef('No Preference', 'Chef de Partie', { Sauce: 2 });
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((dayName) => {
    const preferredDayScore = getSectionCandidateBaseScore({ staff: preferredDaysChef, section: 'Sauce', dayName, ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' });
    const noPreferenceScore = getSectionCandidateBaseScore({ staff: noPreferenceChef, section: 'Sauce', dayName, ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' });
    assert(preferredDayScore < noPreferenceScore, `Preferred Days Off: ${dayName} is honored as a soft scheduling preference`);
  });

  const legacyChef = createTestChef('Legacy Chef', 'Chef de Partie', { Sauce: 2 }, {
    weekendRule: 'Does not work weekends',
    weekend_rule: true,
    fixedDayOff: 'Saturday',
    fixedDaysOff: ['Saturday'],
    fixed_days_off: ['Sunday'],
    preferredBreakfast: 'Sunday',
    breakfastCompetency: 3,
    skills: { Sauce: 2, Breakfast: 3 }
  });
  const normalizedLegacyChef = normalizeChefRecord(legacyChef);
  assert(!Object.prototype.hasOwnProperty.call(normalizedLegacyChef, 'weekendRule'), 'Legacy chef data loads safely and drops the obsolete property during normalization');
  assert(!['weekend_rule', 'fixedDayOff', 'fixedDaysOff', 'fixed_days_off'].some((field) => Object.prototype.hasOwnProperty.call(normalizedLegacyChef, field)), 'All legacy fixed-day and weekend field variants are dropped during normalization');
  assert(JSON.stringify(normalizedLegacyChef.preferredDaysOff) === JSON.stringify(['Saturday']), 'Legacy Fixed Day Off migrates into Preferred Days Off without converting weekend-rule values');
  assert(normalizedLegacyChef.preferredBreakfast === 'Sunday', 'Legacy Preferred breakfast day survives normalization');
  assert(!Object.prototype.hasOwnProperty.call(normalizedLegacyChef, 'breakfastCompetency') && !Object.prototype.hasOwnProperty.call(normalizedLegacyChef.skills, 'Breakfast'), 'Legacy Breakfast competency is safely discarded during normalization');
  assert(!isUnavailable(legacyChef, '2026-07-18', 'Saturday', { _availability: [] }), 'Legacy weekend values no longer create a solver constraint');
  assert(
    getSectionCandidateBaseScore({ staff: legacyChef, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
      === getSectionCandidateBaseScore({ staff: noPreferenceChef, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' }),
    'Legacy weekend values no longer affect solver scoring'
  );

  const seniorCompetentPass = createTestChef('Senior Pass', 'Sous Chef', { Pass: 2 }, { senior: true });
  const nonSeniorPreferredPass = createTestChef('Non-senior Pass', 'Chef de Partie', { Pass: 3 });
  const passCandidates = [seniorCompetentPass, nonSeniorPreferredPass].sort((a, b) => (
    getSectionCandidateBaseScore({ staff: b, section: 'Pass', dayName: 'Friday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
    - getSectionCandidateBaseScore({ staff: a, section: 'Pass', dayName: 'Friday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
  ));
  assert(passCandidates[0].name === 'Senior Pass', 'Scenario E: senior Competent Pass candidate outranks non-senior Preferred fallback on Pass');
  assert(sectionCandidateScore(preferredGarnish, 'Garnish') > sectionCandidateScore(competentGarnish, 'Garnish'), 'Section levels: Preferred ranks above Competent');
  assert(sectionCandidateScore(competentSauce, 'Sauce') > sectionCandidateScore(trainingSauce, 'Sauce'), 'Section levels: Competent ranks above In training');
  assert(!canCoverSection(createTestChef('Blocked Pastry', 'Chef de Partie', { Pastry: 0 }), 'Pastry'), 'Section levels: Should not cover excludes the chef from that section');

  const mioInfeasibleGtState = setupBaseState();
  mioInfeasibleGtState.weeklyInputs.availability = [
    { chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-17', finishDate: '2026-07-19', notes: '' }
  ];
  syncCompatibilityViews();
  const mioInfeasibleGt = runScenario(mioInfeasibleGtState);
  assert(['invalid', 'incomplete'].includes(mioInfeasibleGt.status) && mioInfeasibleGt.rota.length === 7, 'Best effort returns a seven-day rota when selected MIO chef cannot receive 2 GT shifts');
  assert(
    mioInfeasibleGt.hardValidation.some((item) => item.ruleId === 'H022' && !item.passed && item.chefName === 'Dan' && item.suggestedAction),
    'Best-effort result explains the selected MIO GT pattern conflict'
  );

  const mioInfeasibleMioState = setupBaseState();
  mioInfeasibleMioState.weeklyInputs.availability = [
    { chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-16', notes: '' }
  ];
  syncCompatibilityViews();
  const mioInfeasibleMio = runScenario(mioInfeasibleMioState);
  assert(['invalid', 'incomplete'].includes(mioInfeasibleMio.status) && mioInfeasibleMio.rota.length === 7, 'Best effort returns a seven-day rota when selected MIO chef cannot receive 3 MIO shifts');
  assert(
    mioInfeasibleMio.hardValidation.some((item) => item.ruleId === 'H015' && !item.passed && item.chefName === 'Dan' && item.suggestedAction),
    'Best-effort result explains the selected MIO shift conflict'
  );

  assert(getHoursForDay('Wednesday') === 12.5, 'Wednesday normal shift equals 12.5 hours');
  assert(getHoursForDay('Sunday') === 10.5, 'Sunday normal shift equals 10.5 hours');
  assert(getHoursForAssignment('Monday', 'MIO') === 8.5, 'MIO shift equals 8.5 hours');
  assert(getHoursForDay('Thursday', true) === getHoursForDay('Thursday'), 'Breakfast does not increase paid hours');

  const floatSpecialistState = setupBaseState();
  floatSpecialistState.weeklyInputs.additionalChefRequirements = [{ date: '2026-07-17', count: 2 }];
  const floatSpecialist = runScenario(floatSpecialistState);
  const fridayFloatChefs = floatSpecialist.rota.find((day) => day.dayName === 'Friday')?.assignments
    .filter((assignment) => assignment.section === 'Float')
    .map((assignment) => assignment.chef) || [];
  assert(floatSpecialist.status === 'ok', 'Specialists can be assigned to Float without breaking the rota');
  assert(fridayFloatChefs.length >= 2 && fridayFloatChefs.every((name) => floatSpecialistState.staff.some((chef) => chef.name === name)), 'Explicit extra staffing remains represented by valid Float chefs after optimization');

  const greedyOnlyState = setupBaseState();
  const greedyOnlyInputs = {
    weekStart: greedyOnlyState.weeklyInputs.weekStart,
    mioChef: greedyOnlyState.weeklyInputs.mioChef,
    additionalChefRequirements: [],
    availability: []
  };
  const greedyOnly = buildRota(greedyOnlyInputs, {
    searchLimits: {
      initialCandidateCount: 1,
      maxOptimizationIterations: 0,
      maxNeighborEvaluationsPerIteration: 120
    }
  });
  const greedyHard = hardValidateRotaCandidate({
    rota: greedyOnly.rota,
    state: greedyOnlyState,
    inputs: greedyOnlyInputs,
    fullWeekDates: greedyOnly.fullWeekDates
  });
  const greedyScore = scoreSoftPreferences({
    state: greedyOnlyState,
    rota: greedyOnly.rota,
    hardValidation: greedyHard.hardValidation
  }).score;
  const countPreferredDayBreaches = (rota) => rota.reduce((total, day) => total + day.chefs.filter((name) => (
    greedyOnlyState.staff.find((chef) => chef.name === name)?.preferredDaysOff?.includes(day.dayName)
  )).length, 0);
  const greedyBreachCount = countPreferredDayBreaches(greedyOnly.rota);
  const validNeighbors = generateNeighborCandidates({
    rota: greedyOnly.rota,
    state: greedyOnlyState,
    inputs: greedyOnlyInputs,
    limit: 120
  }).map((neighbor) => {
    const hardResult = hardValidateRotaCandidate({
      rota: neighbor.rota,
      state: greedyOnlyState,
      inputs: greedyOnlyInputs,
      fullWeekDates: greedyOnly.fullWeekDates
    });
    return {
      ...neighbor,
      hardResult,
      score: scoreSoftPreferences({
        state: greedyOnlyState,
        rota: neighbor.rota,
        hardValidation: hardResult.hardValidation
      }).score,
      breachCount: countPreferredDayBreaches(neighbor.rota)
    };
  }).filter((neighbor) => neighbor.hardResult.valid);
  const weakerDayOffRepair = validNeighbors.find((neighbor) => (
    neighbor.breachCount < greedyBreachCount && neighbor.score < greedyScore
  ));
  const optimizedGreedy = optimizeRotaCandidate({
    rota: greedyOnly.rota,
    state: greedyOnlyState,
    inputs: greedyOnlyInputs,
    fullWeekDates: greedyOnly.fullWeekDates,
    limits: {
      initialCandidateCount: 1,
      maxOptimizationIterations: 2,
      maxNeighborEvaluationsPerIteration: 120
    }
  });
  assert(!!weakerDayOffRepair, 'A hard-valid day-off repair with a lower aggregate score is available for priority testing');
  assert(
    !weakerDayOffRepair
      || (
        optimizedGreedy.softScore.preferredDayOffViolationCount < greedyBreachCount
        && optimizedGreedy.softScore.preferredDayOffViolationCount <= weakerDayOffRepair.breachCount
      ),
    'Optimization accepts fewer Preferred Day Off violations even when weekend fairness or other soft scoring makes the aggregate score lower'
  );

  const fewerPreferredViolations = {
    valid: true,
    signature: 'fewer-preferred-violations',
    softScore: { preferredDayOffViolationCount: 0, preferredDayOffPenalty: 0, weekendFairnessPenalty: 100, score: 0 }
  };
  const fairerButMorePreferredViolations = {
    valid: true,
    signature: 'fairer-but-more-preferred-violations',
    softScore: { preferredDayOffViolationCount: 1, preferredDayOffPenalty: 2, weekendFairnessPenalty: 0, score: 1000 }
  };
  assert(
    compareCompleteRotaCandidates(fewerPreferredViolations, fairerButMorePreferredViolations) < 0,
    'Weekend fairness cannot beat a hard-valid candidate with fewer Preferred Day Off violations'
  );

  const equallyPreferredFairCandidate = {
    valid: true,
    signature: 'equally-preferred-fair',
    softScore: { preferredDayOffViolationCount: 1, preferredDayOffPenalty: 2, weekendFairnessPenalty: 2, score: 10 }
  };
  const equallyPreferredUnfairCandidate = {
    valid: true,
    signature: 'equally-preferred-unfair',
    softScore: { preferredDayOffViolationCount: 1, preferredDayOffPenalty: 2, weekendFairnessPenalty: 8, score: 100 }
  };
  assert(
    compareCompleteRotaCandidates(equallyPreferredFairCandidate, equallyPreferredUnfairCandidate) < 0,
    'Weekend fairness still decides between candidates with equal Preferred Day Off violations before lower-priority preferences'
  );
  assert(
    compareCompleteRotaCandidates(
      { ...fairerButMorePreferredViolations, valid: true },
      { ...fewerPreferredViolations, valid: false }
    ) < 0,
    'Hard validity remains above Preferred Day Off satisfaction'
  );

  // ─── Multi-week rota generation ────────────────────────────────────────────
  const multiWeekState = setupBaseState();
  const multiWeekInputs = {
    weekStart: multiWeekState.weeklyInputs.weekStart,
    mioChef: multiWeekState.weeklyInputs.mioChef,
    numWeeks: 2,
    weeklyMioSelections: {
      '2026-07-13': 'Dan',
      '2026-07-20': 'Fred',
      '2026-07-27': 'Joel',
      '2026-08-03': 'Camilla'
    },
    additionalChefRequirements: [],
    availability: []
  };

  const twoWeekResult = buildMultiWeekRota(multiWeekInputs);
  assert(twoWeekResult.numberOfWeeks === 2, 'Multi-week: 2-week generation returns exactly 2 results');
  assert(twoWeekResult.weeks.length === 2, 'Multi-week: 2-week structured result includes exactly 2 weeks');
  assert(twoWeekResult.weeks[0].status === 'ok', 'Multi-week: week 1 is feasible');
  assert(twoWeekResult.weeks[1].status === 'ok', 'Multi-week: week 2 is feasible');
  assert(twoWeekResult.weeks[0].mioChef === 'Dan' && twoWeekResult.weeks[1].mioChef === 'Fred', 'Multi-week: different weekly MIO chefs are applied per week');
  assert(
    twoWeekResult.weeks.every((week) => week.softScore?.explanation?.some((line) => line.includes('Multi-week fairness burden spread'))),
    'Multi-week fairness history is included in complete candidate scoring and comparison'
  );
  assert(
    twoWeekResult.weeks.every((week) => Number.isFinite(week.softScore?.preferredDayOffViolationCount)
      && Number.isFinite(week.softScore?.weekendFairnessPenalty)),
    'Multi-week: every week is compared using explicit Preferred Day Off and weekend-fairness priority metrics'
  );
  assert(
    twoWeekResult.weeks.every((week) => !week.rota.some((day) => (
      ['Saturday', 'Sunday'].includes(day.dayName) && day.chefs.includes('Aled')
    ))),
    'Multi-week: weekend rotation does not schedule Aled on a Preferred Day Off when hard-valid alternatives exist'
  );

  const confirmedWeekTwoState = setupBaseState();
  confirmedWeekTwoState.staff.find((chef) => chef.name === 'Connor').mioEligible = true;
  const confirmedWeekTwoResult = buildMultiWeekRota({
    ...multiWeekInputs,
    numWeeks: 2,
    weeklyMioSelections: { '2026-07-13': 'Dan', '2026-07-20': 'Connor' }
  });
  const confirmedWeekTwo = confirmedWeekTwoResult.weeks[1];
  const confirmedDan = confirmedWeekTwo.summary.find((item) => item.name === 'Dan');
  const confirmedMyles = confirmedWeekTwo.summary.find((item) => item.name === 'Myles');
  assert(confirmedWeekTwoResult.status === 'ok' && getVisibleGtChefDayTotal(confirmedWeekTwo.rota) === 38, 'Regression: Week 2 visibly schedules all 38 required GT chef-days');
  assert(confirmedDan.gtDays === 4 && confirmedWeekTwo.rota.filter((day) => getGtChefNamesForDay(day).includes('Dan')).length === 4, 'Regression: Dan cannot display 4/4 without four visible GT assignments');
  assert(confirmedMyles.gtDays === 4 && confirmedWeekTwo.rota.filter((day) => getGtChefNamesForDay(day).includes('Myles')).length === 4, 'Regression: Myles cannot display 4/4 without four visible GT assignments');
  assert(confirmedWeekTwo.rota.every((day) => JSON.stringify(day.chefs) === JSON.stringify(getGtChefNamesForDay(day))), 'Multi-week final candidate normalization prevents phantom day.chefs names');

  const week1Start = multiWeekInputs.weekStart;
  const week2Start = twoWeekResult.weeks[1].weekStart;
  const w1Parts = week1Start.split('-').map(Number);
  const w2Parts = week2Start.split('-').map(Number);
  const w1Date = new Date(w1Parts[0], w1Parts[1] - 1, w1Parts[2]);
  const w2Date = new Date(w2Parts[0], w2Parts[1] - 1, w2Parts[2]);
  const dayDiff = Math.round((w2Date - w1Date) / (1000 * 60 * 60 * 24));
  assert(dayDiff === 7, 'Multi-week: week 2 starts exactly 7 days after week 1');

  twoWeekResult.weeks.forEach((weekResult, wi) => {
    if (weekResult.status !== 'ok') return;
    const hardFails = validateRotaHardRules({
      rota: weekResult.rota,
      state: multiWeekState,
      inputs: weekResult.inputs,
      summary: weekResult.summary,
      fullWeekDates: weekResult.fullWeekDates
    }).filter((r) => !r.passed);
    assert(hardFails.length === 0, `Multi-week: week ${wi + 1} has no hard-rule failures`);
    assert(weekResult.summary.every((item) => item.gtDays === item.adjustedGtTarget), `Multi-week: week ${wi + 1} satisfies exact weekly GT targets`);
  });

  const mixedMioResult = buildMultiWeekRota({
    ...multiWeekInputs,
    numWeeks: 3,
    weeklyMioSelections: {
      '2026-07-13': 'Dan',
      '2026-07-20': '',
      '2026-07-27': 'Fred'
    }
  });
  assert(mixedMioResult.weeks.length === 3 && mixedMioResult.weeks.every((week) => week.status === 'ok'), 'Multi-week: selected-chef and no-MIO weeks can be mixed independently');
  assert(JSON.stringify(mixedMioResult.weeks.map((week) => week.mioChef)) === JSON.stringify(['Dan', '', 'Fred']), 'Multi-week: an explicit empty selection does not fall back to another week\'s MIO chef');
  assert(!mixedMioResult.weeks[1].rota.some((day) => day.assignments.some((assignment) => assignment.section === 'MIO')), 'Multi-week: the no-MIO week contains no MIO assignments');
  assert(mixedMioResult.weeks[1].summary.every((item) => item.gtDays === item.adjustedGtTarget && item.adjustedGtTarget === 4), 'Multi-week: every chef uses normal GT targets in the no-MIO week');
  [mixedMioResult.weeks[0], mixedMioResult.weeks[2]].forEach((week) => {
    const selectedSummary = week.summary.find((item) => item.name === week.mioChef);
    assert(selectedSummary?.mioDays === 3 && selectedSummary?.gtDays === 2, `Multi-week: ${week.mioChef} retains the exact 3 MIO / 2 GT pattern`);
  });

  const fourWeekResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 4 });
  assert(fourWeekResult.weeks.length === 4, 'Multi-week: 4-week generation returns exactly 4 results');
  const feasibleWeeks = fourWeekResult.weeks.filter((week) => week.status === 'ok').length;
  assert(feasibleWeeks >= 3, 'Multi-week: at least 3 of 4 weeks are feasible');

  const eightWeekState = setupBaseState();
  const eightWeekResult = buildMultiWeekRota({
    weekStart: eightWeekState.weeklyInputs.weekStart,
    numWeeks: 8,
    mioChef: '',
    weeklyMioSelections: {},
    additionalChefRequirements: [],
    availability: []
  });
  assert(eightWeekResult.status === 'ok' && eightWeekResult.weeks.length === 8, 'Weekend blocks: representative 8-week rota remains fully feasible');
  assert(
    eightWeekResult.weeks.every((week) => validateRotaHardRules({
      rota: week.rota,
      state: eightWeekState,
      inputs: week.inputs,
      summary: week.summary,
      fullWeekDates: week.fullWeekDates
    }).every((result) => result.passed)),
    'Weekend blocks: representative 8-week rota preserves all hard coverage constraints'
  );
  const blockCounts = Object.fromEntries(eightWeekResult.fairnessSummary.map((entry) => [
    entry.name,
    (entry.friSatBlocksOff || 0) + (entry.satSunBlocksOff || 0)
  ]));
  assert(
    blockCounts.Dan > 0 && blockCounts.Fred > 0,
    'Weekend blocks: Dan and Fred both receive useful blocks during an 8-week Garnish-cover rotation'
  );
  assert(
    blockCounts.Joel > 0 && blockCounts.Connor > 0,
    'Weekend blocks: Joel and Connor both receive useful blocks during an 8-week Sauce-cover rotation'
  );
  assert(
    Math.abs(blockCounts.Dan - blockCounts.Fred) <= 1
      && Math.abs(blockCounts.Joel - blockCounts.Connor) <= 1,
    'Weekend blocks: compatible Garnish and Sauce colleagues receive comparable 8-week block totals'
  );
  assert(
    eightWeekResult.fairnessSummary.every((entry) => (
      Number.isFinite(entry.fridayCount)
      && Number.isFinite(entry.saturdayCount)
      && Number.isFinite(entry.sundayCount)
      && Number.isFinite(entry.friSatBlocksOff)
      && Number.isFinite(entry.satSunBlocksOff)
      && typeof entry.duePriority === 'boolean'
    )),
    'Weekend blocks: multi-week fairness summary exposes duties, both block types, and next-priority status'
  );

  const singleWeekResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 1 });
  assert(singleWeekResult.weeks.length === 1, 'Multi-week: 1-week generation returns exactly 1 result');
  assert(singleWeekResult.weeks[0].weekStart === week1Start, 'Multi-week: 1-week result uses correct weekStart');
  assert(singleWeekResult.fairnessApplied === true, 'Rolling fairness: persisted history also influences one-week generation');

  const outOfRangeResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 0 });
  assert(outOfRangeResult.weeks.length === 1, 'Multi-week: 0 weeks is clamped to 1');
  const overMaxResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 99 });
  assert(overMaxResult.weeks.length === 8, 'Multi-week: 99 weeks is clamped to 8');

  const failedWeekTwo = buildMultiWeekRota({
    ...multiWeekInputs,
    numWeeks: 3,
    availability: [
      { chef: 'Adam', type: 'Annual Leave', startDate: '2026-07-20', finishDate: '2026-07-26', notes: '' },
      { chef: 'Connor', type: 'Annual Leave', startDate: '2026-07-20', finishDate: '2026-07-26', notes: '' }
    ]
  });
  const bestEffortWeekTwo = failedWeekTwo.weeks[1];
  assert(failedWeekTwo.status === 'invalid', 'Multi-week best effort: an invalid week marks the overall result as requiring attention');
  assert(failedWeekTwo.weeks.length === 3 && failedWeekTwo.weeks[2].rota.length === 7, 'Multi-week best effort: generation continues through later weeks after an invalid week');
  assert(bestEffortWeekTwo.status === 'incomplete' && bestEffortWeekTwo.rota.length === 7, 'Multi-week best effort: the affected week retains a complete Monday-to-Sunday table');
  assert(bestEffortWeekTwo.rota.some((day) => getCoreSections(day.dayName).some((section) => !day.assignments.some((assignment) => assignment.section === section))), 'Multi-week best effort: unresolved required assignments remain blank');
  assert(bestEffortWeekTwo.hardValidation.some((issue) => !issue.passed && issue.date && issue.section && issue.suggestedAction), 'Multi-week best effort: invalid output includes actionable cell-mappable validation issues');
  assert(
    bestEffortWeekTwo.validationIssues.every((issue) => issue.type && issue.scope && Number.isInteger(issue.weekIndex) && Array.isArray(issue.affectedCells)),
    'Multi-week best effort: every failed rule exposes structured type, scope, week and affected-cell data'
  );
  assert(bestEffortWeekTwo.fullyValid === false && Number.isFinite(bestEffortWeekTwo.score) && bestEffortWeekTwo.referenceScore === 100 && Array.isArray(bestEffortWeekTwo.preferenceCompromises), 'Multi-week best effort: result exposes validity, score/reference score, and separate preference compromises');
  assert(failedWeekTwo.weeks[0].fullyValid === true && failedWeekTwo.weeks[0].validationIssues.length === 0, 'Multi-week best effort: valid weeks retain an independent fully-valid status');

  const fairnessContext = {
    stats: {
      Dan: { weightedBurden: 8, fridayCount: 1, saturdayCount: 1, sundayCount: 1, repeatedSaturdaySundayPairCount: 1, repeatedFullWeekendCount: 1, repeatedExactPatternCount: 0 },
      Fred: { weightedBurden: 0, fridayCount: 0, saturdayCount: 0, sundayCount: 0, repeatedSaturdaySundayPairCount: 0, repeatedFullWeekendCount: 0, repeatedExactPatternCount: 0 }
    },
    previousWeekPatterns: {
      Dan: { dayNames: ['Friday', 'Saturday', 'Sunday'], saturdaySundayPair: true, fullWeekend: true, signature: 'Friday|Saturday|Sunday' },
      Fred: { dayNames: [], saturdaySundayPair: false, fullWeekend: false, signature: '' }
    }
  };
  assert(compareFairnessTieBreak({ name: 'Dan' }, { name: 'Fred' }, 'Saturday', fairnessContext, {}) > 0, 'Multi-week: Friday/Saturday/Sunday weights affect fairness tie-breaking');

  const sectionQualityState = setupBaseState();
  const sectionQualityResult = buildMultiWeekRota({
    weekStart: sectionQualityState.weeklyInputs.weekStart,
    numWeeks: 2,
    mioChef: 'Dan',
    weeklyMioSelections: {
      '2026-07-13': 'Dan',
      '2026-07-20': 'Dan'
    },
    additionalChefRequirements: [],
    availability: []
  });
  const weekTwoPassChef = sectionQualityResult.weeks[1].rota.find((day) => day.dayName === 'Friday')?.assignments.find((assignment) => assignment.section === 'Pass')?.chef;
  assert(['Aled', 'Charlie', 'Adam', 'Connor'].includes(weekTwoPassChef), 'Multi-week: section quality remains higher priority than fairness on Pass');

  const noPastryState = setupBaseState();
  noPastryState.staff = noPastryState.staff.map((chef) => ({ ...chef, skills: { ...chef.skills, Pastry: 0 } }));
  const noPastryResult = runScenario(noPastryState);
  assert(noPastryResult.status === 'incomplete' && noPastryResult.rota.length === 7, 'Scenario C best effort: missing Pastry eligibility returns an incomplete seven-day rota');
  assert(noPastryResult.hardValidation.some((issue) => issue.ruleId === 'H025' && !issue.passed && issue.section === 'Pastry' && issue.suggestedAction.includes('eligible Pastry chef')), 'Scenario C best effort: every uncovered Pastry cell has a specific actionable validation issue');
  assert(!noPastryResult.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'Pastry' && !canCoverSection(noPastryState.staff.find((chef) => chef.name === assignment.chef), 'Pastry'))), 'Scenario C: Should not cover Pastry chefs are never assigned Pastry');
}
