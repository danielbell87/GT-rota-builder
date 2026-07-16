import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { isSenior, getHoursForDay, getHoursForAssignment } from '../js/scoring.js';
import { validateRotaHardRules } from '../js/validation.js?v=20260714';

function setupBaseState() {
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

function runScenario(state, override = {}) {
  return buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: override.mioChef ?? state.weeklyInputs.mioChef,
    changes: state.weeklyInputs.changes,
    dailyOverrides: state.weeklyInputs.dailyOverrides,
    availability: state.weeklyInputs.availability
  });
}

function getHardFailures(state, result) {
  const hard = validateRotaHardRules({ rota: result.rota, state, inputs: state.weeklyInputs, summary: result.summary });
  return hard.filter((item) => !item.passed);
}

function hasAnyAssignment(result, chefName) {
  return result.rota.some((day) => day.assignments.some((assignment) => assignment.chef === chefName));
}

export async function runSolverTests(assert) {
  const state = setupBaseState();

  const baseline = runScenario(state);
  const baselineFailures = getHardFailures(state, baseline);

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
  const aledWeekend = charlieLeave.rota.some((day) => ['Saturday', 'Sunday'].includes(day.dayName) && day.chefs.includes('Aled'));
  const dailySeniorCover = charlieLeave.rota.every((day) => day.chefs.some((name) => isSenior(charlieLeaveState.staff.find((staff) => staff.name === name))));
  assert(charlieLeave.status === 'ok', 'Charlie full-week annual leave scenario is feasible');
  assert((charlieSummary?.annualLeaveHours || 0) === 48, 'Charlie receives 48 leave-credit hours for full leave week');
  assert(!aledWeekend, 'Aled still does not work weekends when Charlie is on leave');
  assert(dailySeniorCover, 'Every day retains senior cover when Charlie is on leave');
  assert(charlieLeaveFailures.length === 0, 'Charlie full-week leave scenario has no hard failures');

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
  assert(noMonWedOverstaffing, 'Dan unavailable scenario does not overstaff Monday-Wednesday');
  assert(danUnavailableFailures.length === 0, 'Dan Friday unavailable scenario has no hard failures');

  const mylesLeaveState = setupBaseState();
  mylesLeaveState.weeklyInputs.availability = [{ chef: 'Myles', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const mylesLeave = runScenario(mylesLeaveState);
  const mylesLeaveFailures = getHardFailures(mylesLeaveState, mylesLeave);
  const mylesSummary = mylesLeave.summary.find((item) => item.name === 'Myles');
  const mylesAssigned = hasAnyAssignment(mylesLeave, 'Myles');
  assert(mylesLeave.status === 'infeasible', 'Myles full-week annual leave scenario is infeasible under selected MIO 3+2 hard pattern');
  assert((mylesSummary?.annualLeaveHours || 0) === 48, 'Myles receives 48 leave-credit hours for full leave week');
  assert(!mylesAssigned, 'Myles has no assignment during full-week annual leave');
  assert(mylesLeave.validation.some((item) => item.message.includes('Could not build a valid day plan')), 'Infeasible Myles leave scenario reports day-plan conflict');
  assert(mylesLeaveFailures.length === 0, 'Infeasible Myles leave scenario does not break hard-rule checker on produced days');

  const eligibleMio = state.staff.filter((staff) => staff.mioEligible).map((staff) => staff.name).sort();
  const expectedMio = ['Brooke', 'Camilla', 'Dan', 'Fred', 'Joel'];
  assert(JSON.stringify(eligibleMio) === JSON.stringify(expectedMio), 'Default MIO eligibility is Dan/Fred/Joel/Camilla/Brooke only');

  const mylesMioAttempt = runScenario(state, { mioChef: 'Myles' });
  const mylesMioAssigned = mylesMioAttempt.rota.some((day) => day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === 'Myles'));
  assert(!mylesMioAssigned, 'Myles cannot be assigned to MIO');

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
}
