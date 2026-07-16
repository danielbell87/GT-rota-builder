import { WEEKDAYS } from './constants.js';
import { getState } from './state.js';
import { addDays, formatIsoDate, getPlanningWeekStarts, parseLocalDate } from './utils.js';
import {
  getSectionScore,
  getRoleBonus,
  getSoftRulePenalty,
  isSenior,
  getHoursForDay,
  getHoursForAssignment
} from './scoring.js';
import {
  isUnavailable,
  getRequiredChefCount,
  getCoreSections,
  validateRotaHardRules
} from './validation.js?v=20260714';

const PASS_DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIO_PRIMARY_DAYS = ['Monday', 'Tuesday', 'Wednesday'];
const MIO_FALLBACK_DAYS = ['Thursday', 'Friday'];
const MIO_GT_PRIMARY_DAYS = ['Saturday', 'Sunday'];
const MIO_GT_FALLBACK_DAYS = ['Thursday', 'Friday', 'Monday', 'Tuesday', 'Wednesday'];
const GT_WORKING_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SOLVER_ENGINE_VERSION = '2026-07-16-multi-week-fairness';
export const FAIRNESS_DAY_WEIGHTS = {
  Monday: 0,
  Tuesday: 0,
  Wednesday: 1,
  Thursday: 1,
  Friday: 3,
  Saturday: 4,
  Sunday: 4
};
const MAX_FAIRNESS_PENALTY = 8;

function getGtTargetForChef(chefName, mioChefName) {
  return chefName === mioChefName ? 2 : 4;
}

function buildWeekDates(weekStart) {
  const start = parseLocalDate(weekStart);
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    dates.push({ date: formatIsoDate(date), dayName: WEEKDAYS[date.getDay()] });
  }
  return dates;
}

function getAnnualLeaveDatesByChef(state, weekDateSet) {
  const leaveDatesByChef = {};
  (state.weeklyInputs.availability || []).forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    if (!leaveDatesByChef[entry.chef]) leaveDatesByChef[entry.chef] = new Set();
    for (let day = new Date(start); day <= finish; day.setDate(day.getDate() + 1)) {
      const dateStr = formatIsoDate(day);
      if (weekDateSet.has(dateStr)) leaveDatesByChef[entry.chef].add(dateStr);
    }
  });
  return leaveDatesByChef;
}

function getAnnualLeaveHoursByChef(state, weekDateSet) {
  const leaveDatesByChef = getAnnualLeaveDatesByChef(state, weekDateSet);
  const result = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  Object.entries(leaveDatesByChef).forEach(([chef, dateSet]) => {
    result[chef] = Math.min(dateSet.size, 4) * 12;
  });
  return result;
}

function getMioDayPlan(state, dates, mioChefName, ruleOverrides) {
  if (!mioChefName) return new Set();
  const staff = state.staff.find((item) => item.name === mioChefName);
  if (!staff || !staff.mioEligible) return new Set();

  const selected = [];
  MIO_PRIMARY_DAYS.forEach((dayName) => {
    const date = dates.find((item) => item.dayName === dayName);
    if (!date) return;
    if (!isUnavailable(staff, date.date, dayName, ruleOverrides)) selected.push(dayName);
  });

  if (selected.length < 3) {
    MIO_FALLBACK_DAYS.forEach((dayName) => {
      if (selected.length >= 3 || selected.includes(dayName)) return;
      const date = dates.find((item) => item.dayName === dayName);
      if (!date) return;
      if (!isUnavailable(staff, date.date, dayName, ruleOverrides)) selected.push(dayName);
    });
  }

  return new Set(selected);
}

function getMioGtDayPlanOptions(state, dates, mioChefName, mioDays, ruleOverrides) {
  if (!mioChefName) return [new Set()];
  const staff = state.staff.find((item) => item.name === mioChefName);
  if (!staff || !staff.mioEligible) return [new Set()];

  const target = getGtTargetForChef(mioChefName, mioChefName);
  const orderedUniqueDays = [...new Set([...MIO_GT_PRIMARY_DAYS, ...MIO_GT_FALLBACK_DAYS])];
  const availableDays = orderedUniqueDays.filter((dayName) => {
    if (mioDays.has(dayName)) return false;
    const date = dates.find((item) => item.dayName === dayName);
    if (!date) return false;
    return !isUnavailable(staff, date.date, dayName, ruleOverrides);
  });
  if (availableDays.length < target) return [];

  const combinations = [];
  for (let i = 0; i < availableDays.length; i += 1) {
    for (let j = i + 1; j < availableDays.length; j += 1) {
      const days = [availableDays[i], availableDays[j]];
      const weekendCount = days.filter((day) => MIO_GT_PRIMARY_DAYS.includes(day)).length;
      const orderScore = days.reduce((sum, day) => sum + (orderedUniqueDays.length - orderedUniqueDays.indexOf(day)), 0);
      combinations.push({ days, priority: (weekendCount * 100) + orderScore });
    }
  }

  return combinations
    .sort((a, b) => b.priority - a.priority || a.days.join('|').localeCompare(b.days.join('|')))
    .map((item) => new Set(item.days));
}

function chooseSeniorPassPlan({ state, dates, ruleOverrides, mioChefName, mioDays }) {
  const plannedCounts = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const forcedByDay = {};

  PASS_DAYS.forEach((dayName) => {
    const dateInfo = dates.find((day) => day.dayName === dayName);
    if (!dateInfo) return;

    const seniors = state.staff
      .filter((staff) => isSenior(staff))
      .filter((staff) => !isUnavailable(staff, dateInfo.date, dayName, ruleOverrides))
      .filter((staff) => !(staff.name === mioChefName && mioDays.has(dayName)))
      .filter((staff) => plannedCounts[staff.name] < getGtTargetForChef(staff.name, mioChefName))
      .sort((a, b) => {
        const passA = getSectionScore(a, 'Pass', ruleOverrides);
        const passB = getSectionScore(b, 'Pass', ruleOverrides);
        if (passB !== passA) return passB - passA;
        if (plannedCounts[a.name] !== plannedCounts[b.name]) return plannedCounts[a.name] - plannedCounts[b.name];
        return a.name.localeCompare(b.name);
      });

    if (!seniors.length) return;
    forcedByDay[dayName] = seniors[0].name;
    plannedCounts[seniors[0].name] += 1;
  });

  return forcedByDay;
}

export function getEmptyFairnessRecord() {
  return {
    fridayCount: 0,
    saturdayCount: 0,
    sundayCount: 0,
    weightedBurden: 0,
    consecutiveFridayOccurrences: 0,
    consecutiveSaturdayOccurrences: 0,
    consecutiveSundayOccurrences: 0,
    repeatedSaturdaySundayPairs: 0,
    repeatedFridaySaturdaySundayWeekends: 0,
    repeatedExactGtWorkingDayPatterns: 0,
    lastFridayWorked: false,
    lastSaturdayWorked: false,
    lastSundayWorked: false,
    lastSaturdaySundayPair: false,
    lastFullWeekend: false,
    lastPattern: ''
  };
}

export function createFairnessState(staff) {
  return Object.fromEntries((staff || []).map((member) => [member.name, getEmptyFairnessRecord()]));
}

function createCurrentWeekAttendance(staff) {
  return Object.fromEntries((staff || []).map((member) => [member.name, {
    days: [],
    workedFriday: false,
    workedSaturday: false,
    workedSunday: false
  }]));
}

function sortWorkedDays(days) {
  return [...days].sort((a, b) => GT_WORKING_DAY_ORDER.indexOf(a) - GT_WORKING_DAY_ORDER.indexOf(b));
}

function getWorkedPattern(days) {
  return sortWorkedDays(days).join('|');
}

function updateCurrentWeekAttendance(currentWeekAttendance, chefName, dayName) {
  const record = currentWeekAttendance[chefName];
  if (!record || record.days.includes(dayName)) return;
  record.days.push(dayName);
  if (dayName === 'Friday') record.workedFriday = true;
  if (dayName === 'Saturday') record.workedSaturday = true;
  if (dayName === 'Sunday') record.workedSunday = true;
}

export function getFairnessPenalty({ chefName, dayName, fairnessState = {}, currentWeekAttendance = {} }) {
  const prior = fairnessState[chefName] || getEmptyFairnessRecord();
  const current = currentWeekAttendance[chefName] || { days: [], workedFriday: false, workedSaturday: false, workedSunday: false };
  const dayWeight = FAIRNESS_DAY_WEIGHTS[dayName] || 0;
  let penalty = 0;

  penalty += prior.weightedBurden * (dayWeight / 10);
  penalty += (prior.fridayCount || 0) * (dayName === 'Friday' ? 1.6 : 0.2);
  penalty += (prior.saturdayCount || 0) * (dayName === 'Saturday' ? 1.8 : 0.2);
  penalty += (prior.sundayCount || 0) * (dayName === 'Sunday' ? 1.8 : 0.2);

  if (dayName === 'Friday') penalty += (prior.consecutiveFridayOccurrences || 0) * 2.5;
  if (dayName === 'Saturday') penalty += (prior.consecutiveSaturdayOccurrences || 0) * 3;
  if (dayName === 'Sunday') penalty += (prior.consecutiveSundayOccurrences || 0) * 3;

  if (dayName === 'Sunday' && current.workedSaturday && prior.lastSaturdaySundayPair) {
    penalty += 4 + (prior.repeatedSaturdaySundayPairs || 0);
  }
  if (dayName === 'Sunday' && current.workedFriday && current.workedSaturday && prior.lastFullWeekend) {
    penalty += 5 + (prior.repeatedFridaySaturdaySundayWeekends || 0);
  }

  const prospectivePattern = getWorkedPattern([...current.days, dayName]);
  if (prior.lastPattern && prospectivePattern === prior.lastPattern) {
    penalty += 3 + (prior.repeatedExactGtWorkingDayPatterns || 0);
  }

  return Math.min(penalty, MAX_FAIRNESS_PENALTY);
}

export function summarizeWeekFairness(rota, staff) {
  const attendance = createCurrentWeekAttendance(staff);
  rota.forEach((day) => {
    day.chefs.forEach((chefName) => updateCurrentWeekAttendance(attendance, chefName, day.dayName));
  });

  return (staff || []).map((member) => {
    const workedDays = sortWorkedDays(attendance[member.name]?.days || []);
    const fridayWorked = workedDays.includes('Friday');
    const saturdayWorked = workedDays.includes('Saturday');
    const sundayWorked = workedDays.includes('Sunday');
    return {
      name: member.name,
      fridayShifts: fridayWorked ? 1 : 0,
      saturdayShifts: saturdayWorked ? 1 : 0,
      sundayShifts: sundayWorked ? 1 : 0,
      weightedBurden: workedDays.reduce((sum, dayName) => sum + (FAIRNESS_DAY_WEIGHTS[dayName] || 0), 0),
      workedDays,
      exactPattern: getWorkedPattern(workedDays),
      saturdaySundayPair: saturdayWorked && sundayWorked,
      fridaySaturdaySundayWeekend: fridayWorked && saturdayWorked && sundayWorked
    };
  });
}

function applyWeekFairnessToState(fairnessState, weekFairnessSummary) {
  const nextState = { ...fairnessState };
  weekFairnessSummary.forEach((item) => {
    const prior = nextState[item.name] || getEmptyFairnessRecord();
    nextState[item.name] = {
      fridayCount: (prior.fridayCount || 0) + item.fridayShifts,
      saturdayCount: (prior.saturdayCount || 0) + item.saturdayShifts,
      sundayCount: (prior.sundayCount || 0) + item.sundayShifts,
      weightedBurden: (prior.weightedBurden || 0) + item.weightedBurden,
      consecutiveFridayOccurrences: item.fridayShifts ? (prior.consecutiveFridayOccurrences || 0) + 1 : 0,
      consecutiveSaturdayOccurrences: item.saturdayShifts ? (prior.consecutiveSaturdayOccurrences || 0) + 1 : 0,
      consecutiveSundayOccurrences: item.sundayShifts ? (prior.consecutiveSundayOccurrences || 0) + 1 : 0,
      repeatedSaturdaySundayPairs: (prior.repeatedSaturdaySundayPairs || 0) + (item.saturdaySundayPair && prior.lastSaturdaySundayPair ? 1 : 0),
      repeatedFridaySaturdaySundayWeekends: (prior.repeatedFridaySaturdaySundayWeekends || 0) + (item.fridaySaturdaySundayWeekend && prior.lastFullWeekend ? 1 : 0),
      repeatedExactGtWorkingDayPatterns: (prior.repeatedExactGtWorkingDayPatterns || 0) + (item.exactPattern && item.exactPattern === prior.lastPattern ? 1 : 0),
      lastFridayWorked: !!item.fridayShifts,
      lastSaturdayWorked: !!item.saturdayShifts,
      lastSundayWorked: !!item.sundayShifts,
      lastSaturdaySundayPair: !!item.saturdaySundayPair,
      lastFullWeekend: !!item.fridaySaturdaySundayWeekend,
      lastPattern: item.exactPattern
    };
  });
  return nextState;
}

function buildAggregateFairnessSummary(fairnessState, staff) {
  return (staff || []).map((member) => {
    const item = fairnessState[member.name] || getEmptyFairnessRecord();
    return {
      name: member.name,
      fridayShifts: item.fridayCount || 0,
      saturdayShifts: item.saturdayCount || 0,
      sundayShifts: item.sundayCount || 0,
      weightedBurden: item.weightedBurden || 0,
      consecutiveFridayOccurrences: item.consecutiveFridayOccurrences || 0,
      consecutiveSaturdayOccurrences: item.consecutiveSaturdayOccurrences || 0,
      consecutiveSundayOccurrences: item.consecutiveSundayOccurrences || 0,
      repeatedSaturdaySundayPairs: item.repeatedSaturdaySundayPairs || 0,
      repeatedFridaySaturdaySundayWeekends: item.repeatedFridaySaturdaySundayWeekends || 0,
      repeatedExactGtWorkingDayPatterns: item.repeatedExactGtWorkingDayPatterns || 0
    };
  });
}

function pickBestForSection({
  section,
  dayName,
  candidates,
  selectedNames,
  ruleOverrides,
  gtDaysByChef,
  mioChefName,
  fairnessState,
  currentWeekAttendance,
  fairnessEnabled
}) {
  const sectionCandidates = candidates
    .filter((staff) => !selectedNames.has(staff.name))
    .sort((a, b) => {
      const urgencyA = Math.max(getGtTargetForChef(a.name, mioChefName) - (gtDaysByChef[a.name] || 0), 0) * 2;
      const urgencyB = Math.max(getGtTargetForChef(b.name, mioChefName) - (gtDaysByChef[b.name] || 0), 0) * 2;
      const mioWeekendBoostA = a.name === mioChefName && ['Saturday', 'Sunday'].includes(dayName) ? 10 : 0;
      const mioWeekendBoostB = b.name === mioChefName && ['Saturday', 'Sunday'].includes(dayName) ? 10 : 0;
      const passSeniorA = section === 'Pass' && PASS_DAYS.includes(dayName) && isSenior(a) ? 120 : 0;
      const passSeniorB = section === 'Pass' && PASS_DAYS.includes(dayName) && isSenior(b) ? 120 : 0;
      const passPrefA = section === 'Pass' && (a.preferredSections || []).includes('Pass') ? 8 : 0;
      const passPrefB = section === 'Pass' && (b.preferredSections || []).includes('Pass') ? 8 : 0;
      const fairnessPenaltyA = fairnessEnabled ? getFairnessPenalty({ chefName: a.name, dayName, fairnessState, currentWeekAttendance }) : 0;
      const fairnessPenaltyB = fairnessEnabled ? getFairnessPenalty({ chefName: b.name, dayName, fairnessState, currentWeekAttendance }) : 0;

      const scoreA = (getSectionScore(a, section, ruleOverrides) * 10)
        + getRoleBonus(a, dayName)
        + urgencyA
        + mioWeekendBoostA
        + passSeniorA
        + passPrefA
        - getSoftRulePenalty(a.name, dayName)
        - (gtDaysByChef[a.name] || 0)
        - fairnessPenaltyA;

      const scoreB = (getSectionScore(b, section, ruleOverrides) * 10)
        + getRoleBonus(b, dayName)
        + urgencyB
        + mioWeekendBoostB
        + passSeniorB
        + passPrefB
        - getSoftRulePenalty(b.name, dayName)
        - (gtDaysByChef[b.name] || 0)
        - fairnessPenaltyB;

      return scoreB - scoreA || a.name.localeCompare(b.name);
    });

  return sectionCandidates[0] || null;
}

function ensureSeniorCoverage({ assignments, dayName, candidates, selectedNames, ruleOverrides }) {
  const hasSenior = [...selectedNames].some((name) => {
    const staff = candidates.find((item) => item.name === name);
    return isSenior(staff);
  });
  if (hasSenior) return;

  const replacementSenior = candidates
    .filter((staff) => isSenior(staff))
    .filter((staff) => !selectedNames.has(staff.name))
    .sort((a, b) => getRoleBonus(b, dayName) - getRoleBonus(a, dayName) || a.name.localeCompare(b.name))[0];

  if (!replacementSenior) return;

  let weakest = null;
  assignments.forEach((assignment, index) => {
    const incumbent = candidates.find((item) => item.name === assignment.chef);
    if (!incumbent) return;
    const incumbentScore = getSectionScore(incumbent, assignment.section, ruleOverrides);
    const seniorScore = getSectionScore(replacementSenior, assignment.section, ruleOverrides);
    const degradation = incumbentScore - seniorScore;
    if (weakest === null || degradation < weakest.degradation) {
      weakest = { index, chef: incumbent.name, degradation };
    }
  });

  if (!weakest) return;
  assignments[weakest.index].chef = replacementSenior.name;
  selectedNames.delete(weakest.chef);
  selectedNames.add(replacementSenior.name);
}

function createDayPlan({
  state,
  dayName,
  date,
  requiredChefs,
  coreSections,
  ruleOverrides,
  candidates,
  gtDaysByChef,
  breakfastCounts,
  mioChefName,
  forcedPassSeniorName,
  forcedChefName,
  fairnessState,
  currentWeekAttendance,
  fairnessEnabled
}) {
  if (requiredChefs < coreSections.length || candidates.length < requiredChefs) return null;

  const assignments = [];
  const selectedNames = new Set();

  if (forcedPassSeniorName && coreSections.includes('Pass')) {
    const forced = candidates.find((staff) => staff.name === forcedPassSeniorName);
    if (forced && !selectedNames.has(forced.name)) {
      assignments.push({ chef: forced.name, section: 'Pass' });
      selectedNames.add(forced.name);
    }
  }

  if (forcedChefName && !selectedNames.has(forcedChefName)) {
    const forced = candidates.find((staff) => staff.name === forcedChefName);
    if (!forced) return null;
    const availableSections = coreSections.filter((section) => !assignments.some((item) => item.section === section));
    if (!availableSections.length) return null;
    const bestSection = availableSections
      .slice()
      .sort((a, b) => getSectionScore(forced, b, ruleOverrides) - getSectionScore(forced, a, ruleOverrides) || a.localeCompare(b))[0];
    assignments.push({ chef: forced.name, section: bestSection });
    selectedNames.add(forced.name);
  }

  coreSections.forEach((section) => {
    if (assignments.some((item) => item.section === section)) return;
    const best = pickBestForSection({
      section,
      dayName,
      candidates,
      selectedNames,
      ruleOverrides,
      gtDaysByChef,
      mioChefName,
      fairnessState,
      currentWeekAttendance,
      fairnessEnabled
    });
    if (!best) return;
    assignments.push({ chef: best.name, section });
    selectedNames.add(best.name);
  });

  if (assignments.length !== coreSections.length) return null;

  ensureSeniorCoverage({ assignments, dayName, candidates, selectedNames, ruleOverrides });

  while (selectedNames.size < requiredChefs) {
    const extra = candidates
      .filter((staff) => !selectedNames.has(staff.name))
      .sort((a, b) => {
        const urgencyA = Math.max(getGtTargetForChef(a.name, mioChefName) - (gtDaysByChef[a.name] || 0), 0);
        const urgencyB = Math.max(getGtTargetForChef(b.name, mioChefName) - (gtDaysByChef[b.name] || 0), 0);
        const seniorA = isSenior(a) ? 1 : 0;
        const seniorB = isSenior(b) ? 1 : 0;
        const fairnessPenaltyA = fairnessEnabled ? getFairnessPenalty({ chefName: a.name, dayName, fairnessState, currentWeekAttendance }) : 0;
        const fairnessPenaltyB = fairnessEnabled ? getFairnessPenalty({ chefName: b.name, dayName, fairnessState, currentWeekAttendance }) : 0;
        if (seniorB !== seniorA) return seniorB - seniorA;
        if (urgencyB !== urgencyA) return urgencyB - urgencyA;
        return (getRoleBonus(b, dayName) - fairnessPenaltyB) - (getRoleBonus(a, dayName) - fairnessPenaltyA) || a.name.localeCompare(b.name);
      })[0];

    if (!extra) return null;
    selectedNames.add(extra.name);
  }

  const coreChefs = assignments.map((assignment) => assignment.chef);
  const breakfastChef = coreChefs
    .map((name) => state.staff.find((staff) => staff.name === name))
    .filter((staff) => !!staff && staff.breakfastEligible)
    .sort((a, b) => {
      const countA = breakfastCounts[a.name] || 0;
      const countB = breakfastCounts[b.name] || 0;
      if (countA !== countB) return countA - countB;
      return getSectionScore(b, 'Breakfast', ruleOverrides) - getSectionScore(a, 'Breakfast', ruleOverrides) || a.name.localeCompare(b.name);
    })[0];

  if (!breakfastChef) return null;
  assignments.push({ chef: breakfastChef.name, section: 'Breakfast' });

  return {
    dayName,
    date,
    chefs: [...selectedNames],
    assignments
  };
}

function buildInfeasibleResult(message, summary = [], hardValidation = []) {
  return {
    status: 'infeasible',
    rota: [],
    validation: [{ day: 'Overall', message, severity: 'bad' }],
    hardValidation,
    summary,
    fairnessSummary: [],
    reason: message
  };
}

export function buildRota(inputs, options = {}) {
  const state = getState();
  const dates = buildWeekDates(inputs.weekStart);
  const weekDateSet = new Set(dates.map((item) => item.date));
  const ruleOverrides = { _availability: state.weeklyInputs.availability };
  const annualLeaveHoursByChef = getAnnualLeaveHoursByChef(state, weekDateSet);
  const fairnessState = options.fairnessState || createFairnessState(state.staff);
  const fairnessEnabled = !!options.fairnessEnabled;
  const currentWeekAttendance = createCurrentWeekAttendance(state.staff);

  const mioChefName = inputs.mioChef;
  const mioChef = state.staff.find((staff) => staff.name === mioChefName);
  const mioDays = getMioDayPlan(state, dates, mioChefName, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible && mioDays.size !== 3) {
    return buildInfeasibleResult(`${mioChefName}: cannot place exactly 3 MIO shifts due to availability/unavailability constraints.`);
  }

  const mioGtDayPlanOptions = getMioGtDayPlanOptions(state, dates, mioChefName, mioDays, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible && !mioGtDayPlanOptions.length) {
    return buildInfeasibleResult(`${mioChefName}: cannot place exactly 2 GT shifts on non-MIO days due to availability/unavailability constraints.`);
  }

  const attemptPlans = mioGtDayPlanOptions.length ? mioGtDayPlanOptions : [new Set()];

  for (let i = 0; i < attemptPlans.length; i += 1) {
    const mioGtDays = attemptPlans[i];
    const gtDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
    const mioDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
    const gtHoursByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
    const mioHoursByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
    const breakfastCounts = {};
    const validation = [];
    const rota = [];
    const forcedSeniorPassByDay = chooseSeniorPassPlan({ state, dates, ruleOverrides, mioChefName, mioDays });

    for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
      const { dayName, date } = dates[dayIndex];
      const requiredChefs = getRequiredChefCount(dayName, inputs, date);
      const coreSections = getCoreSections(dayName, inputs);

      const candidates = state.staff.filter((staff) => {
        if (gtDaysByChef[staff.name] >= getGtTargetForChef(staff.name, mioChefName)) return false;
        if (isUnavailable(staff, date, dayName, ruleOverrides)) return false;
        if (staff.name === mioChefName && mioDays.has(dayName)) return false;
        if (staff.name === mioChefName && !mioGtDays.has(dayName)) return false;
        return true;
      });

      const dayPlan = createDayPlan({
        state,
        dayName,
        date,
        requiredChefs,
        coreSections,
        ruleOverrides,
        candidates,
        gtDaysByChef,
        breakfastCounts,
        mioChefName,
        forcedPassSeniorName: forcedSeniorPassByDay[dayName],
        forcedChefName: mioGtDays.has(dayName) ? mioChefName : null,
        fairnessState,
        currentWeekAttendance,
        fairnessEnabled
      });

      if (!dayPlan) {
        validation.push({ day: dayName, message: 'Could not build a valid day plan with current hard constraints.', severity: 'bad' });
        break;
      }

      const breakfastAssignment = dayPlan.assignments.find((assignment) => assignment.section === 'Breakfast');
      if (breakfastAssignment) {
        breakfastCounts[breakfastAssignment.chef] = (breakfastCounts[breakfastAssignment.chef] || 0) + 1;
      }

      dayPlan.chefs.forEach((chefName) => {
        gtDaysByChef[chefName] += 1;
        gtHoursByChef[chefName] += getHoursForDay(dayName);
        updateCurrentWeekAttendance(currentWeekAttendance, chefName, dayName);
      });

      if (mioChef && mioChef.mioEligible && mioDays.has(dayName) && !isUnavailable(mioChef, date, dayName, ruleOverrides)) {
        dayPlan.assignments.push({ chef: mioChefName, section: 'MIO' });
        mioDaysByChef[mioChefName] += 1;
        mioHoursByChef[mioChefName] += getHoursForAssignment(dayName, 'MIO');
      }

      rota.push(dayPlan);
    }

    const summary = state.staff.map((staff) => {
      const totalCreditedHours = (gtHoursByChef[staff.name] || 0) + (mioHoursByChef[staff.name] || 0) + (annualLeaveHoursByChef[staff.name] || 0);
      return {
        name: staff.name,
        count: gtDaysByChef[staff.name] || 0,
        gtDays: gtDaysByChef[staff.name] || 0,
        mioDays: mioDaysByChef[staff.name] || 0,
        gtHours: gtHoursByChef[staff.name] || 0,
        mioHours: mioHoursByChef[staff.name] || 0,
        annualLeaveHours: annualLeaveHoursByChef[staff.name] || 0,
        totalCreditedHours,
        hours: totalCreditedHours
      };
    });

    const hardValidation = validateRotaHardRules({ rota, state, inputs, summary });
    const hardFailures = hardValidation.filter((result) => !result.passed);
    const fairnessSummary = summarizeWeekFairness(rota, state.staff);
    const reason = validation[0]?.message || hardFailures[0]?.message || '';
    const isFeasible = rota.length === dates.length && !validation.some((item) => item.severity === 'bad') && hardFailures.length === 0;

    if (isFeasible) {
      return {
        status: 'ok',
        rota,
        validation,
        hardValidation,
        summary,
        fairnessSummary,
        reason: ''
      };
    }

    if (i === attemptPlans.length - 1) {
      return {
        status: 'infeasible',
        rota,
        validation: validation.concat(hardFailures.map((result) => ({ day: 'Overall', message: `${result.ruleId}: ${result.message}`, severity: 'bad' }))),
        hardValidation,
        summary,
        fairnessSummary,
        reason: reason || 'Could not build a valid week plan with current hard constraints.'
      };
    }
  }

  return buildInfeasibleResult('Could not build a valid week plan with current hard constraints.');
}

export function buildMultiWeekRota(inputs, numWeeks) {
  const state = getState();
  const weeks = Math.max(1, Math.min(8, Number(numWeeks) || 1));
  const weekStarts = getPlanningWeekStarts(inputs.weekStart, weeks);
  let fairnessState = createFairnessState(state.staff);
  const results = [];

  for (let index = 0; index < weekStarts.length; index += 1) {
    const weekStart = weekStarts[index];
    const mioChef = inputs.mioSelectionsByWeek?.[weekStart] || (index === 0 ? inputs.mioChef : inputs.mioChef);
    const weekInputs = {
      ...inputs,
      weekStart,
      mioChef
    };
    const result = buildRota(weekInputs, {
      fairnessState,
      fairnessEnabled: weeks > 1
    });

    if (result.status !== 'ok') {
      return {
        status: 'infeasible',
        failedWeek: index + 1,
        failedWeekStart: weekStart,
        reason: result.reason || result.validation?.[0]?.message || 'Could not build a valid week plan with current hard constraints.',
        weeks: results,
        fairnessSummary: buildAggregateFairnessSummary(fairnessState, state.staff)
      };
    }

    fairnessState = applyWeekFairnessToState(fairnessState, result.fairnessSummary);
    results.push({
      weekIndex: index + 1,
      weekStart,
      mioChef,
      ...result
    });
  }

  return {
    status: 'ok',
    weeks: results,
    fairnessSummary: buildAggregateFairnessSummary(fairnessState, state.staff)
  };
}

export function advanceWeekStart(weekStart, days) {
  return addDays(weekStart, days);
}
