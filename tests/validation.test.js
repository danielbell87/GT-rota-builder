import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildRota, summarizeRota } from '../js/solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid, getStaffConfigurationWarnings } from '../js/validation.js?v=20260719o';
import { getGtChefNamesForDay, GT_SECTIONS } from '../js/rota-model.js';

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
  const match = rule?.message?.match(/exactly (\d+) GT days \(actual (\d+)\)/);
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
  assert(validation.filter((v) => v.ruleId === 'H016').every((v) => v.passed), 'Baseline satisfies exact weekly GT target validation for every chef');
  assert(validation.filter((v) => ['H026', 'H027'].includes(v.ruleId)).every((v) => v.passed), 'Baseline satisfies explicit primary GT assignment validation including Float');

  const softValidation = validateRotaSoftRules({ rota: result.rota, state, inputs: state.weeklyInputs });
  const passPreferenceChecks = softValidation.filter((v) => v.ruleId === 'prefer-senior-on-pass');
  assert(passPreferenceChecks.length === 4, 'Soft validation reports senior-on-Pass checks Thu-Sun');
  assert(passPreferenceChecks.every((v) => v.passed), 'Baseline rota satisfies senior-on-Pass soft preference');

  const roleOnlySeniorState = JSON.parse(JSON.stringify(state));
  roleOnlySeniorState.staff.forEach((chef) => { chef.senior = false; });
  roleOnlySeniorState.staff[0].role = 'Executive Chef';
  const roleOnlySeniorValidation = validateRotaHardRules({ rota: result.rota, state: roleOnlySeniorState, inputs: roleOnlySeniorState.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(roleOnlySeniorValidation.some((v) => v.ruleId === 'H008' && !v.passed), 'Role alone never satisfies senior-cover validation');

  const explicitSeniorState = JSON.parse(JSON.stringify(roleOnlySeniorState));
  const mondaySeniorName = result.rota[0].chefs[0];
  const mondaySeniorChef = explicitSeniorState.staff.find((chef) => chef.name === mondaySeniorName);
  mondaySeniorChef.role = 'Commis Chef';
  mondaySeniorChef.senior = true;
  const mondayOnlyRota = [result.rota[0]];
  const explicitSeniorValidation = validateRotaHardRules({ rota: mondayOnlyRota, state: explicitSeniorState, inputs: explicitSeniorState.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(explicitSeniorValidation.some((v) => v.ruleId === 'H008' && v.passed), 'Only canonical senior true satisfies senior-cover validation regardless of role');

  const breakfastEligibilityCorrupted = JSON.parse(JSON.stringify(result.rota));
  const firstBreakfast = breakfastEligibilityCorrupted[0].assignments.find((assignment) => assignment.section === 'Breakfast');
  const breakfastEligibilityState = JSON.parse(JSON.stringify(state));
  breakfastEligibilityState.staff.find((chef) => chef.name === firstBreakfast.chef).breakfastEligible = false;
  const breakfastEligibilityValidation = validateRotaHardRules({ rota: breakfastEligibilityCorrupted, state: breakfastEligibilityState, inputs: breakfastEligibilityState.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(breakfastEligibilityValidation.some((v) => v.ruleId === 'H028' && !v.passed), 'Validation rejects a Breakfast assignment for an ineligible chef');

  const floatBreakfastRota = JSON.parse(JSON.stringify(result.rota));
  const floatBreakfastDay = floatBreakfastRota.find((day) => day.assignments.some((assignment) => {
    if (assignment.section !== 'Float') return false;
    return state.staff.find((chef) => chef.name === assignment.chef)?.breakfastEligible === true;
  }));
  const eligibleFloat = floatBreakfastDay?.assignments.find((assignment) => (
    assignment.section === 'Float'
      && state.staff.find((chef) => chef.name === assignment.chef)?.breakfastEligible === true
  ));
  if (floatBreakfastDay && eligibleFloat) {
    floatBreakfastDay.assignments.find((assignment) => assignment.section === 'Breakfast').chef = eligibleFloat.chef;
  }
  const floatBreakfastValidation = validateRotaHardRules({
    rota: floatBreakfastRota,
    state,
    inputs: state.weeklyInputs,
    summary: result.summary,
    fullWeekDates: result.fullWeekDates
  });
  assert(
    !!eligibleFloat && !floatBreakfastValidation.some((v) => ['H007', 'H028'].includes(v.ruleId) && !v.passed),
    'Validation allows a Breakfast-eligible chef already working Float to cover Breakfast'
  );

  const sectionEligibilityState = JSON.parse(JSON.stringify(state));
  const sectionEligibilityCorrupted = JSON.parse(JSON.stringify(result.rota));
  const firstCoreAssignment = sectionEligibilityCorrupted[0].assignments.find((assignment) => ['Sauce', 'Garnish', 'Larder', 'Pastry'].includes(assignment.section));
  sectionEligibilityState.staff.find((chef) => chef.name === firstCoreAssignment.chef).skills[firstCoreAssignment.section] = 0;
  const sectionEligibilityValidation = validateRotaHardRules({
    rota: sectionEligibilityCorrupted,
    state: sectionEligibilityState,
    inputs: sectionEligibilityState.weeklyInputs,
    summary: result.summary,
    fullWeekDates: result.fullWeekDates
  });
  assert(sectionEligibilityValidation.some((v) => v.ruleId === 'H025' && !v.passed), 'Hard validation rejects an ineligible core-section assignment');

  const availabilityValidationState = JSON.parse(JSON.stringify(state));
  const assignedMondayChef = result.rota[0].chefs[0];
  availabilityValidationState.weeklyInputs.availability = [{
    chef: assignedMondayChef,
    type: 'Unavailable',
    startDate: result.rota[0].date,
    finishDate: result.rota[0].date,
    notes: ''
  }];
  const availabilityValidation = validateRotaHardRules({
    rota: result.rota,
    state: availabilityValidationState,
    inputs: availabilityValidationState.weeklyInputs,
    summary: result.summary,
    fullWeekDates: result.fullWeekDates
  });
  assert(availabilityValidation.some((v) => v.ruleId === 'H019' && !v.passed), 'Hard validation independently rejects a chef assigned while unavailable');

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
    monday.assignments.push({ chef: 'Dan', section: 'Float' });
  }
  const mioOverlapValidation = validateRotaHardRules({ rota: mioOverlapCorrupted, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(mioOverlapValidation.some((v) => v.ruleId === 'H023' && !v.passed), 'Hard validation rejects same-day GT and MIO for selected MIO chef');

  const exactTargetCorrupted = JSON.parse(JSON.stringify(result.rota));
  const fredDay = exactTargetCorrupted.find((day) => day.chefs.includes('Fred'));
  if (fredDay) {
    fredDay.chefs = fredDay.chefs.filter((chef) => chef !== 'Fred');
    fredDay.assignments = fredDay.assignments.filter((assignment) => assignment.chef !== 'Fred');
  }
  const exactTargetValidation = validateRotaHardRules({ rota: exactTargetCorrupted, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(
    exactTargetValidation.some((v) => v.ruleId === 'H016' && !v.passed && v.message.includes('expected exactly 4 GT days (actual 3)')),
    'Hard validation fails when a chef falls below their exact GT target'
  );

  const canonicalTargets = Object.fromEntries(state.staff.map((chef) => [
    chef.name,
    chef.name === state.weeklyInputs.mioChef ? 2 : 4
  ]));
  const phantomRota = JSON.parse(JSON.stringify(result.rota));
  const phantomDay = phantomRota.find((day) => !getGtChefNamesForDay(day).includes('Dan'));
  phantomDay.chefs.push('Dan');
  const phantomSummary = summarizeRota({
    state, rota: phantomRota, mioChefName: state.weeklyInputs.mioChef,
    annualLeaveHoursByChef: {}, gtTargetsByChef: canonicalTargets
  }).summary;
  const phantomDanSummary = phantomSummary.find((item) => item.name === 'Dan');
  const stalePhantomSummary = JSON.parse(JSON.stringify(phantomSummary));
  const stalePhantomDan = stalePhantomSummary.find((item) => item.name === 'Dan');
  stalePhantomDan.gtDays += 1;
  stalePhantomDan.gtHours += 12.5;
  const phantomValidation = validateRotaHardRules({
    rota: phantomRota, state, inputs: state.weeklyInputs,
    summary: stalePhantomSummary, fullWeekDates: result.fullWeekDates
  });
  assert(phantomDanSummary.gtDays === 2 && phantomDanSummary.gtHours < 36, 'Canonical GT summary ignores a phantom day.chefs name and awards no phantom hours');
  assert(phantomValidation.some((item) => item.ruleId === 'H033' && !item.passed && item.message.includes('Extra internal chef: Dan')), 'Hard validation reports an internal chef without a visible GT assignment');
  assert(phantomValidation.some((item) => item.ruleId === 'H034' && !item.passed), 'Hard validation rejects a summarized GT-day total that differs from visible chef-days');
  assert(phantomValidation.some((item) => item.ruleId === 'H035' && !item.passed && item.message.startsWith('Dan:')), 'Hard validation rejects a chef summary that differs from visible assignments');

  const visibleThreeDayRota = JSON.parse(JSON.stringify(result.rota));
  const fredVisibleDay = visibleThreeDayRota.find((day) => getGtChefNamesForDay(day).includes('Fred'));
  fredVisibleDay.assignments = fredVisibleDay.assignments.filter((assignment) => (
    assignment.chef !== 'Fred' || !GT_SECTIONS.includes(assignment.section)
  ));
  const visibleThreeDaySummary = summarizeRota({
    state, rota: visibleThreeDayRota, mioChefName: state.weeklyInputs.mioChef,
    annualLeaveHoursByChef: {}, gtTargetsByChef: canonicalTargets
  }).summary;
  const visibleFred = visibleThreeDaySummary.find((item) => item.name === 'Fred');
  const visibleThreeDayValidation = validateRotaHardRules({
    rota: visibleThreeDayRota, state, inputs: state.weeklyInputs,
    summary: visibleThreeDaySummary, fullWeekDates: result.fullWeekDates
  });
  assert(visibleFred.gtDays === 3 && visibleFred.gtHours < 48, 'Three visible GT assignments report 3/4 and cannot produce 48 GT hours');
  assert(visibleThreeDayValidation.some((item) => item.ruleId === 'H016' && !item.passed && item.message.includes('actual 3')), 'Three visible GT days cannot pass exact-target validation');

  fredVisibleDay.assignments.push({ chef: 'Fred', section: 'Float' });
  const restoredFred = summarizeRota({
    state, rota: visibleThreeDayRota, mioChefName: state.weeklyInputs.mioChef,
    annualLeaveHoursByChef: {}, gtTargetsByChef: canonicalTargets
  }).summary.find((item) => item.name === 'Fred');
  assert(restoredFred.gtDays === 4, 'A visible Float assignment restores a chef from 3/4 to 4/4 GT days');

  const overlayRota = JSON.parse(JSON.stringify(result.rota));
  const danOverlayDay = overlayRota.find((day) => getGtChefNamesForDay(day).includes('Dan'));
  danOverlayDay.assignments.push({ chef: 'Dan', section: 'Breakfast' });
  const mylesMioOnlyDay = overlayRota.find((day) => !getGtChefNamesForDay(day).includes('Myles'));
  mylesMioOnlyDay.assignments.push({ chef: 'Myles', section: 'MIO' });
  const overlaySummary = summarizeRota({
    state, rota: overlayRota, mioChefName: state.weeklyInputs.mioChef,
    annualLeaveHoursByChef: {}, gtTargetsByChef: canonicalTargets
  }).summary;
  assert(overlaySummary.find((item) => item.name === 'Dan').gtDays === 2, 'Breakfast overlay does not add a GT day');
  assert(
    overlaySummary.find((item) => item.name === 'Myles').gtDays === result.summary.find((item) => item.name === 'Myles').gtDays,
    'MIO-only assignment does not count as a GT day'
  );

  const floatCorrupted = JSON.parse(JSON.stringify(result.rota));
  const firstFloatDay = floatCorrupted.find((day) => day.assignments.some((assignment) => assignment.section === 'Float'));
  if (firstFloatDay) {
    firstFloatDay.assignments = firstFloatDay.assignments.filter((assignment) => assignment.section !== 'Float');
  }
  const floatValidation = validateRotaHardRules({ rota: floatCorrupted, state, inputs: state.weeklyInputs, summary: result.summary, fullWeekDates: result.fullWeekDates });
  assert(floatValidation.some((v) => v.ruleId === 'H033' && !v.passed), 'Hard validation rejects an internal GT chef without a visible primary assignment');

  const fullWeekDates = result.fullWeekDates;
  const fredFourDayPartial = result.rota.filter((day) => day.chefs.includes('Fred'));
  const fredThreeDayPartial = fredFourDayPartial.slice(0, 3);

  const sundayLeaveState = setupState();
  sundayLeaveState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-19', finishDate: '2026-07-19', notes: '' }];
  syncCompatibilityViews();
  const sundayLeaveSummary = result.summary.map((item) => item.name === 'Fred'
    ? {
      ...item,
      annualLeaveHours: 12,
      totalCreditedHours: (item.totalCreditedHours || item.hours || 0) + 12,
      hours: (item.hours || item.totalCreditedHours || 0) + 12
    }
    : item);
  const sundayLeaveValidation = validateRotaHardRules({
    rota: fredFourDayPartial,
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
  const fridayLeaveSummary = result.summary.map((item) => item.name === 'Fred'
    ? {
      ...item,
      annualLeaveHours: 12,
      totalCreditedHours: (item.totalCreditedHours || item.hours || 0) + 12,
      hours: (item.hours || item.totalCreditedHours || 0) + 12
    }
    : item);
  const fridayLeaveValidation = validateRotaHardRules({
    rota: fredThreeDayPartial,
    state: fridayLeaveState,
    inputs: fridayLeaveState.weeklyInputs,
    summary: fridayLeaveSummary,
    fullWeekDates
  });
  const fridayLeaveH016 = findRule(fridayLeaveValidation, 'H016', 'Fred');
  const fridayLeaveTarget = parseGtDayRule(fridayLeaveH016);
  assert(fridayLeaveH016?.passed, 'Partial rota stopping on Wednesday correctly adjusts the GT target for Friday leave');
  assert(fridayLeaveTarget?.target === 3 && fridayLeaveTarget?.actual === 3, 'Later Friday leave still reduces the expected GT target');
  const fridayFailurePartial = fredFourDayPartial;
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
    rota: fredFourDayPartial,
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
  assert(emptyH016 && !emptyH016.passed && emptyTarget?.target === 3 && emptyTarget?.actual === 0, 'Empty rota still calculates the leave-adjusted GT target against the supplied full requested week');
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
  const firstDanGtDay = result.rota.find((day) => day.chefs.includes('Dan'));
  const mioPartial = result.rota.filter((day) => day.date !== firstDanGtDay?.date);
  const mioLeaveValidation = validateRotaHardRules({
    rota: mioPartial,
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

  const leaveTargetState = setupState();
  leaveTargetState.weeklyInputs.availability = [{ chef: 'Fred', type: 'Annual Leave', startDate: '2026-07-14', finishDate: '2026-07-14', notes: '' }];
  syncCompatibilityViews();
  const leaveTargetResult = buildRota({
    weekStart: leaveTargetState.weeklyInputs.weekStart,
    mioChef: leaveTargetState.weeklyInputs.mioChef,
    additionalChefRequirements: [],
    availability: leaveTargetState.weeklyInputs.availability
  });
  const leaveTargetSummary = leaveTargetResult.summary.find((item) => item.name === 'Fred');
  assert((leaveTargetSummary?.adjustedGtTarget || 0) === 3, 'Validation fixtures expose adjusted GT targets after annual leave');
  assert((leaveTargetSummary?.gtDays || 0) === 3, 'Adjusted GT target is matched exactly after annual leave');

  const warningState = setupState();
  warningState.staff = warningState.staff.map((chef) => ({ ...chef, skills: { ...chef.skills, Sauce: 0 } }));
  const warnings = getStaffConfigurationWarnings(warningState.staff);
  assert(warnings.length === 1 && warnings[0].message.includes('Sauce'), 'Staff validation warns when no chef can cover a required section');

  const breakfastWarningState = setupState();
  breakfastWarningState.staff = breakfastWarningState.staff.map((chef) => ({ ...chef, breakfastEligible: false }));
  assert(getStaffConfigurationWarnings(breakfastWarningState.staff).some((warning) => warning.message.includes('Breakfast')), 'Staff validation warns when no chef is Breakfast eligible');
  breakfastWarningState.staff[0].breakfastEligible = true;
  assert(!getStaffConfigurationWarnings(breakfastWarningState.staff).some((warning) => warning.message.includes('Breakfast')), 'Breakfast eligibility alone satisfies the Breakfast qualification check');
}
