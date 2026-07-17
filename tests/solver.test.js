import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota, buildMultiWeekRota, compareFairnessTieBreak, getSectionCandidateBaseScore } from '../js/solver.js';
import { isSenior, getHoursForDay, getHoursForAssignment } from '../js/scoring.js';
import { isUnavailable, validateRotaHardRules } from '../js/validation.js?v=20260717h';
import { canCoverSection, sectionCandidateScore } from '../js/section-levels.js';
import { normalizeChefRecord } from '../js/staff.js';

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
      Breakfast: 2,
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
  const danBaseline = baseline.summary.find((item) => item.name === 'Dan');
  assert((danBaseline?.mioDays || 0) === 3, 'Selected MIO chef receives exactly 3 MIO shifts in baseline');
  assert((danBaseline?.gtDays || 0) === 2, 'Selected MIO chef receives exactly 2 GT shifts in baseline');
  const danMioGtOverlap = baseline.rota.some((day) => day.chefs.includes('Dan') && day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === 'Dan'));
  assert(!danMioGtOverlap, 'Selected MIO chef is never assigned MIO and GT on the same day');
  const danWeekendGt = baseline.rota
    .filter((day) => ['Saturday', 'Sunday'].includes(day.dayName))
    .every((day) => day.chefs.includes('Dan'));
  assert(danWeekendGt, 'Selected MIO chef is preferentially assigned to weekend GT days when available');
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

  const breakfastIneligibleState = setupBaseState();
  breakfastIneligibleState.staff.find((chef) => chef.name === 'Aled').breakfastEligible = false;
  const breakfastIneligibleResult = runScenario(breakfastIneligibleState);
  assert(
    breakfastIneligibleResult.rota.every((day) => !day.assignments.some((assignment) => assignment.section === 'Breakfast' && assignment.chef === 'Aled')),
    'Breakfast-ineligible chefs are never assigned Breakfast'
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
  assert(state.staff.find((chef) => chef.name === 'Myles')?.skills?.Larder === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Myles')?.skills || {}).every(([section, level]) => section === 'Larder' || section === 'Breakfast' || level === 0), 'Defaults: Myles remains Larder-only');
  assert(state.staff.find((chef) => chef.name === 'Fred')?.skills?.Garnish === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Fred')?.skills || {}).every(([section, level]) => section === 'Garnish' || section === 'Breakfast' || level === 0), 'Defaults: Fred remains Garnish-only');
  assert(state.staff.find((chef) => chef.name === 'Joel')?.skills?.Sauce === 3 && Object.entries(state.staff.find((chef) => chef.name === 'Joel')?.skills || {}).every(([section, level]) => section === 'Sauce' || section === 'Breakfast' || level === 0), 'Defaults: Joel remains Sauce-only');
  assert(state.staff.every((chef) => chef.notes === ''), 'Defaults: notes do not duplicate structured section levels');

  const mylesMioAttempt = runScenario(state, { mioChef: 'Myles' });
  const mylesMioAssigned = mylesMioAttempt.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === 'Myles'));
  assert(!mylesMioAssigned, 'Myles cannot be assigned to MIO');

  const mondayExtraState = setupBaseState();
  mondayExtraState.weeklyInputs.additionalChefRequirements = [{ date: '2026-07-13', count: 1 }];
  const mondayExtra = runScenario(mondayExtraState);
  const mondayPlan = mondayExtra.rota.find((day) => day.dayName === 'Monday');
  assert(mondayExtra.status === 'ok', 'An explicit Monday extra-chef request remains feasible');
  assert((mondayPlan?.chefs.length || 0) === 5, 'Monday to Wednesday adds the exact requested extra GT chef only when explicitly requested');
  assert((mondayPlan?.assignments.filter((assignment) => assignment.section === 'Float').length || 0) === 1, 'An explicit extra Monday chef is shown as Float once core sections are covered');

  const preferredGarnish = createTestChef('Chef A', 'Chef de Partie', { Garnish: 3, Breakfast: 2 });
  const competentGarnish = createTestChef('Chef B', 'Chef de Partie', { Garnish: 2, Breakfast: 2 });
  const garnishCandidates = [preferredGarnish, competentGarnish].sort((a, b) => (
    getSectionCandidateBaseScore({ staff: b, section: 'Garnish', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
    - getSectionCandidateBaseScore({ staff: a, section: 'Garnish', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
  ));
  assert(garnishCandidates[0].name === 'Chef A', 'Scenario A: Preferred candidate outranks otherwise equivalent Competent candidate');

  const competentSauce = createTestChef('Chef A', 'Chef de Partie', { Sauce: 2, Breakfast: 2 });
  const trainingSauce = createTestChef('Chef B', 'Chef de Partie', { Sauce: 1, Breakfast: 2 });
  const sauceCandidates = [competentSauce, trainingSauce].sort((a, b) => (
    getSectionCandidateBaseScore({ staff: b, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
    - getSectionCandidateBaseScore({ staff: a, section: 'Sauce', dayName: 'Thursday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
  ));
  assert(sauceCandidates[0].name === 'Chef A', 'Scenario B: Competent candidate outranks otherwise equivalent In training candidate');

  const fairnessConflictCandidates = [createTestChef('Preferred Sauce', 'Chef de Partie', { Sauce: 3, Breakfast: 2 }), createTestChef('Training Sauce', 'Chef de Partie', { Sauce: 1, Breakfast: 2 })];
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
    fixed_days_off: ['Sunday']
  });
  const normalizedLegacyChef = normalizeChefRecord(legacyChef);
  assert(!Object.prototype.hasOwnProperty.call(normalizedLegacyChef, 'weekendRule'), 'Legacy chef data loads safely and drops the obsolete property during normalization');
  assert(!['weekend_rule', 'fixedDayOff', 'fixedDaysOff', 'fixed_days_off'].some((field) => Object.prototype.hasOwnProperty.call(normalizedLegacyChef, field)), 'All legacy fixed-day and weekend field variants are dropped during normalization');
  assert(JSON.stringify(normalizedLegacyChef.preferredDaysOff) === JSON.stringify(['Saturday']), 'Legacy Fixed Day Off migrates into Preferred Days Off without converting weekend-rule values');
  assert(!isUnavailable(legacyChef, '2026-07-18', 'Saturday', { _availability: [] }), 'Legacy weekend values no longer create a solver constraint');
  assert(
    getSectionCandidateBaseScore({ staff: legacyChef, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' })
      === getSectionCandidateBaseScore({ staff: noPreferenceChef, section: 'Sauce', dayName: 'Saturday', ruleOverrides: {}, gtDaysByChef: {}, mioChefName: '' }),
    'Legacy weekend values no longer affect solver scoring'
  );

  const seniorCompetentPass = createTestChef('Senior Pass', 'Sous Chef', { Pass: 2, Breakfast: 2 }, { senior: true });
  const nonSeniorPreferredPass = createTestChef('Non-senior Pass', 'Chef de Partie', { Pass: 3, Breakfast: 2 });
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
  assert(mioInfeasibleGt.status === 'infeasible', 'Solver returns infeasible when selected MIO chef cannot receive 2 GT shifts');
  assert(
    mioInfeasibleGt.validation.some((item) => item.message.includes('exactly 2 GT shifts')),
    'Infeasible result explains selected MIO GT pattern conflict'
  );

  const mioInfeasibleMioState = setupBaseState();
  mioInfeasibleMioState.weeklyInputs.availability = [
    { chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-16', notes: '' }
  ];
  syncCompatibilityViews();
  const mioInfeasibleMio = runScenario(mioInfeasibleMioState);
  assert(mioInfeasibleMio.status === 'infeasible', 'Solver returns infeasible when selected MIO chef cannot receive 3 MIO shifts');
  assert(
    mioInfeasibleMio.validation.some((item) => item.message.includes('exactly 3 MIO shifts')),
    'Infeasible result explains selected MIO shift conflict'
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
  assert(fridayFloatChefs.some((chef) => ['Myles', 'Fred', 'Joel'].includes(chef)), 'Specialist chefs can be selected for explicit Float work');

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

  const fourWeekResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 4 });
  assert(fourWeekResult.weeks.length === 4, 'Multi-week: 4-week generation returns exactly 4 results');
  const feasibleWeeks = fourWeekResult.weeks.filter((week) => week.status === 'ok').length;
  assert(feasibleWeeks >= 3, 'Multi-week: at least 3 of 4 weeks are feasible');

  const singleWeekResult = buildMultiWeekRota({ ...multiWeekInputs, numWeeks: 1 });
  assert(singleWeekResult.weeks.length === 1, 'Multi-week: 1-week generation returns exactly 1 result');
  assert(singleWeekResult.weeks[0].weekStart === week1Start, 'Multi-week: 1-week result uses correct weekStart');
  assert(singleWeekResult.fairnessApplied === false, 'Multi-week: fairness is disabled for one-week generation');

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
  assert(failedWeekTwo.status === 'infeasible', 'Multi-week: failed week 2 makes the overall result infeasible');
  assert(failedWeekTwo.failedWeek === 2, 'Multi-week: structured infeasible result reports the failed week number');
  assert(failedWeekTwo.weeks.length === 2, 'Multi-week: generation stops immediately after the failed week');

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
  assert(noPastryResult.status === 'infeasible', 'Scenario C: solver returns infeasible when no valid Pastry cover exists');
  assert(!noPastryResult.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'Pastry' && !canCoverSection(noPastryState.staff.find((chef) => chef.name === assignment.chef), 'Pastry'))), 'Scenario C: Should not cover Pastry chefs are never assigned Pastry');
}
