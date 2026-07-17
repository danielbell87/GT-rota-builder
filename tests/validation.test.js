import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid } from '../js/validation.js?v=20260717a';

function createSummary(state, annualLeaveHoursByChef = {}) {
  return state.staff.map((chef) => {
    const annualLeaveHours = annualLeaveHoursByChef[chef.name] || 0;
    return {
      name: chef.name,
      count: 0,
      gtDays: 0,
      mioDays: 0,
      gtHours: 0,
      mioHours: 0,
      annualLeaveHours,
      totalCreditedHours: annualLeaveHours,
      hours: annualLeaveHours
    };
  });
}

function findRule(validation, ruleId, chefName) {
  return validation.find((item) => item.ruleId === ruleId && (typeof chefName === 'undefined' || item.message.startsWith(`${chefName}:`)));
}

function parseGtDayRule(rule) {
  const match = rule?.message?.match(/at most (\d+) GT days \(actual (\d+)\)/);
  return match ? { target: Number(match[1]), actual: Number(match[2]) } : null;
}

function parseExactShiftRule(rule, shiftLabel) {
  const match = rule?.message?.match(new RegExp(`exactly (\\d+) ${shiftLabel} \\(actual (\\d+)\\)`));
  return match ? { expected: Number(match[1]), actual: Number(match[2]) } : null;
}

function setupState() {
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

export async function runValidationTests(assert) {
  const state = setupState();
  const result = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    additionalChefRequirements: [],
    availability: []
  });

  const validation = validateRotaHardRules({ rota: result.rota, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
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
  const corruptedValidation = validateRotaHardRules({ rota: corrupted, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(corruptedValidation.some((v) => v.ruleId === 'H006' && !v.passed), 'Validator catches intentionally corrupted rota');

  const invalid = !isRotaValid(corruptedValidation);
  assert(invalid, 'Invalid rotas are rejected, not merely warned');

  const mioOverlapCorrupted = JSON.parse(JSON.stringify(result.rota));
  const monday = mioOverlapCorrupted.find((day) => day.dayName === 'Monday');
  if (monday) {
    monday.chefs.push('Dan');
  }
  const mioOverlapValidation = validateRotaHardRules({ rota: mioOverlapCorrupted, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(mioOverlapValidation.some((v) => v.ruleId === 'H023' && !v.passed), 'Hard validation rejects same-day GT and MIO for selected MIO chef');

  const fullWeekDates = result.fullWeekDates;

  const sundayLeaveState = setupState();
  sundayLeaveState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-19', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const saturdayPartial = result.rota.filter((day) => day.dayName !== 'Sunday');
  const sundayLeaveSummary = result.summary.map((item) => item.name === 'Fred'
    ? {
      ...item,
      annualLeaveHours: 12,
      totalCreditedHours: (item.totalCreditedHours || item.hours || 0) + 12,
      hours: (item.hours || item.totalCreditedHours || 0) + 12
    }
    : item);
  const sundayLeaveValidation = validateRotaHardRules({
    rota: saturdayPartial,
    state: sundayLeaveState,
    inputs: sundayLeaveState.weeklyInputs,
    summary: sundayLeaveSummary,
    fullWeekDates
  });
  const sundayLeaveH016 = findRule(sundayLeaveValidation, 'H016', 'Fred');
  const sundayLeaveTarget = parseGtDayRule(sundayLeaveH016);
  assert(sundayLeaveH016 && !sundayLeaveH016.passed, 'Partial rota uses the full requested week for later Sunday annual leave');
  assert(sundayLeaveTarget?.target === 3 && sundayLeaveTarget?.actual === 4, 'H016 reports adjusted target 3 when leave falls after partial-rota failure');

  const fridayLeaveState = setupState();
  fridayLeaveState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-17', finishDate: '2026-07-17', notes: '' }];
  syncCompatibilityViews();
  const wednesdayPartial = result.rota.filter((day) => ['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName));
  const fridayLeaveSummary = result.summary.map((item) => item.name === 'Fred'
    ? {
      ...item,
      annualLeaveHours: 12,
      totalCreditedHours: (item.totalCreditedHours || item.hours || 0) + 12,
      hours: (item.hours || item.totalCreditedHours || 0) + 12
    }
    : item);
  const fridayLeaveValidation = validateRotaHardRules({
    rota: wednesdayPartial,
    state: fridayLeaveState,
    inputs: fridayLeaveState.weeklyInputs,
    summary: fridayLeaveSummary,
    fullWeekDates
  });
  const fridayLeaveH016 = findRule(fridayLeaveValidation, 'H016', 'Fred');
  const fridayLeaveTarget = parseGtDayRule(fridayLeaveH016);
  assert(fridayLeaveH016?.passed, 'Partial rota stopping on Wednesday correctly adjusts the GT target for Friday leave');
  assert(fridayLeaveTarget?.target === 3 && fridayLeaveTarget?.actual === 3, 'Later Friday leave still reduces the expected GT target');
  const fridayFailurePartial = result.rota.filter((day) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day.dayName));
  const fridayLeaveFailureValidation = validateRotaHardRules({
    rota: fridayFailurePartial,
    state: fridayLeaveState,
    inputs: fridayLeaveState.weeklyInputs,
    summary: fridayLeaveSummary,
    fullWeekDates
  });
  const fridayLeaveFailureH016 = findRule(fridayLeaveFailureValidation, 'H016', 'Fred');
  const fridayLeaveFailureTarget = parseGtDayRule(fridayLeaveFailureH016);
  assert(fridayLeaveFailureH016 && !fridayLeaveFailureH016.passed && fridayLeaveFailureTarget?.target === 3 && fridayLeaveFailureTarget?.actual === 4, 'Friday leave still fails H016 when actual GT days exceed the adjusted target');

  const weekendLeaveState = setupState();
  weekendLeaveState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-18', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const fridayPartial = fridayFailurePartial;
  const weekendLeaveSummary = result.summary.map((item) => item.name === 'Fred'
    ? {
      ...item,
      annualLeaveHours: 24,
      totalCreditedHours: (item.totalCreditedHours || item.hours || 0) + 24,
      hours: (item.hours || item.totalCreditedHours || 0) + 24
    }
    : item);
  const weekendLeaveValidation = validateRotaHardRules({
    rota: fridayPartial,
    state: weekendLeaveState,
    inputs: weekendLeaveState.weeklyInputs,
    summary: weekendLeaveSummary,
    fullWeekDates
  });
  const weekendLeaveH016 = findRule(weekendLeaveValidation, 'H016', 'Fred');
  const weekendLeaveTarget = parseGtDayRule(weekendLeaveH016);
  assert(weekendLeaveH016 && !weekendLeaveH016.passed, 'Multiple leave dates after failure still reduce the adjusted GT target');
  assert(weekendLeaveTarget?.target === 2 && weekendLeaveTarget?.actual === 4, 'Adjusted GT target reflects multiple leave dates after failure');

  const noLeaveState = setupState();
  const noLeaveValidation = validateRotaHardRules({
    rota: saturdayPartial,
    state: noLeaveState,
    inputs: noLeaveState.weeklyInputs,
    summary: result.summary,
    fullWeekDates
  });
  const noLeaveH016 = findRule(noLeaveValidation, 'H016', 'Fred');
  const noLeaveTarget = parseGtDayRule(noLeaveH016);
  assert(noLeaveH016?.passed, 'Partial rota without annual leave keeps the normal weekly GT target');
  assert(noLeaveTarget?.target === 4 && noLeaveTarget?.actual === 4, 'No-annual-leave partial rota still expects the normal target of 4');

  const emptyLeaveState = setupState();
  emptyLeaveState.weeklyInputs.availability = [{ chef: 'Adam', type: 'Annual Leave', startDate: '2026-07-19', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const emptySummary = createSummary(emptyLeaveState, { Adam: 12 });
  const emptyValidation = validateRotaHardRules({
    rota: [],
    state: emptyLeaveState,
    inputs: emptyLeaveState.weeklyInputs,
    summary: emptySummary,
    fullWeekDates
  });
  const emptyH016 = findRule(emptyValidation, 'H016', 'Adam');
  const emptyH018 = findRule(emptyValidation, 'H018', 'Adam');
  const emptyTarget = parseGtDayRule(emptyH016);
  assert(emptyH016?.passed && emptyTarget?.target === 3 && emptyTarget?.actual === 0, 'Empty rota still validates GT target against the supplied full requested week');
  assert(emptyH018?.passed, 'Empty rota still validates annual leave credit using the supplied full requested week');

  const fullWeekValidation = validateRotaHardRules({
    rota: result.rota,
    state: noLeaveState,
    inputs: noLeaveState.weeklyInputs,
    summary: result.summary,
    fullWeekDates
  });
  const fullWeekH016 = findRule(fullWeekValidation, 'H016', 'Fred');
  const fullWeekTarget = parseGtDayRule(fullWeekH016);
  assert(fullWeekH016?.passed && fullWeekTarget?.target === 4 && fullWeekTarget?.actual === 4, 'Full rota behaviour remains unchanged with the complete week horizon');

  const mioLeaveState = setupState();
  mioLeaveState.weeklyInputs.availability = [{ chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-19', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const mioLeaveValidation = validateRotaHardRules({
    rota: saturdayPartial,
    state: mioLeaveState,
    inputs: mioLeaveState.weeklyInputs,
    summary: result.summary,
    fullWeekDates
  });
  const mioH015 = findRule(mioLeaveValidation, 'H015', 'Dan');
  const mioH022 = findRule(mioLeaveValidation, 'H022', 'Dan');
  const mioGtTarget = parseExactShiftRule(mioH022, 'GT shifts');
  assert(mioH015?.passed, 'Selected MIO chef still validates exactly 3 MIO shifts against the generated rota days');
  assert(mioH022 && !mioH022.passed && mioGtTarget?.expected === 2 && mioGtTarget?.actual === 1, 'Selected MIO chef keeps the existing 2 GT-shift rule');

  const finalBaselineState = setupState();
  const softCorrupted = JSON.parse(JSON.stringify(result.rota));
  const thursday = softCorrupted.find((day) => day.dayName === 'Thursday');
  if (thursday) {
    const pass = thursday.assignments.find((a) => a.section === 'Pass');
    if (pass) pass.chef = 'Dan';
  }
  const softCorruptedValidation = validateRotaSoftRules({ rota: softCorrupted, state: finalBaselineState, inputs: finalBaselineState.weeklyInputs });
  assert(
    softCorruptedValidation.some((v) => v.ruleId === 'prefer-senior-on-pass' && !v.passed),
    'Soft validation flags non-senior Pass assignment when a senior is available'
  );

  finalBaselineState.weeklyInputs.availability = [{ chef: 'Dan', type: 'Unavailable', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }];
  syncCompatibilityViews();
  const rerun = buildRota({
    weekStart: finalBaselineState.weeklyInputs.weekStart,
    mioChef: finalBaselineState.weeklyInputs.mioChef,
    additionalChefRequirements: [],
    availability: finalBaselineState.weeklyInputs.availability
  });
  const unavailableWorked = rerun.rota.some((day) => day.date === '2026-07-14' && day.chefs.includes('Dan'));
  assert(!unavailableWorked, 'Unavailable request counts as normal day off for scheduling');
}
