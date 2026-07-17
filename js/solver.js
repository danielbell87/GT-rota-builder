import { WEEKDAYS, DAY_FAIRNESS_WEIGHTS, SHIFT_LENGTHS, CORE_SECTIONS } from './constants.js';
import { getState } from './state.js';
import { parseLocalDate, toDateString, getWeekStartAtOffset, normalizeWeekStart } from './utils.js';
import {
  getSectionScore,
  getRoleBonus,
  getSoftRulePenalty,
  isSenior,
  getHoursForDay,
  getHoursForAssignment
} from './scoring.js';
import { canCoverSection, sectionCandidateScore } from './section-levels.js';
import {
  isUnavailable,
  getRequiredChefCount,
  getCoreSections,
  validateRotaHardRules,
  getAdjustedGtTargetsByChef,
  getAnnualLeaveDatesByChef
} from './validation.js?v=20260717e';
import { filterAvailabilityForWeek, filterAdditionalChefRequirementsForWeek } from './weekly-inputs.js';

const PASS_DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIO_PRIMARY_DAYS = ['Monday', 'Tuesday', 'Wednesday'];
const MIO_FALLBACK_DAYS = ['Thursday', 'Friday'];
const MIO_GT_PRIMARY_DAYS = ['Saturday', 'Sunday'];
const MIO_GT_FALLBACK_DAYS = ['Thursday', 'Friday', 'Monday', 'Tuesday', 'Wednesday'];
const FLOAT_PRIORITY_DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SOLVER_ENGINE_VERSION = '2026-07-17-weekly-target-float';

function getChefGtTarget(chefName, mioChefName, gtTargetsByChef = null) {
  if (gtTargetsByChef && Number.isFinite(gtTargetsByChef[chefName])) return gtTargetsByChef[chefName];
  return chefName === mioChefName ? 2 : 4;
}

function clampNumWeeks(value) {
  return Math.max(1, Math.min(8, Number.parseInt(value, 10) || 1));
}

function buildWeekDates(weekStart) {
  const start = parseLocalDate(normalizeWeekStart(weekStart));
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    dates.push({
      date: toDateString(date),
      dayName: WEEKDAYS[date.getDay()]
    });
  }
  return dates;
}

function getAvailabilityEntries(inputs, state) {
  return Array.isArray(inputs?.availability) ? inputs.availability : (state.weeklyInputs.availability || []);
}

function getAnnualLeaveHoursByChef(staff, availability, weekDateSet) {
  const leaveDatesByChef = getAnnualLeaveDatesByChef(availability, weekDateSet);
  const actualLeaveDatesByChef = {};
  Object.entries(leaveDatesByChef).forEach(([chef, dates]) => {
    actualLeaveDatesByChef[chef] = new Set(dates);
  });
  const result = Object.fromEntries(staff.map((member) => [member.name, 0]));
  Object.entries(actualLeaveDatesByChef).forEach(([chef, dateSet]) => {
    result[chef] = Math.min(dateSet.size, 4) * SHIFT_LENGTHS.annualLeaveCreditPerDay;
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
    if (selected.length >= 3) return;
    if (selected.includes(dayName)) return;
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

  const target = getChefGtTarget(mioChefName, mioChefName);
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
    .sort((a, b) => b.priority - a.priority)
    .map((item) => new Set(item.days));
}

function chooseSeniorPassPlan({ state, dates, ruleOverrides, mioChefName, mioDays, gtTargetsByChef }) {
  const plannedCounts = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const forcedByDay = {};

  PASS_DAYS.forEach((dayName) => {
    const dateInfo = dates.find((day) => day.dayName === dayName);
    if (!dateInfo) return;

    const seniors = state.staff
      .filter((staff) => isSenior(staff))
      .filter((staff) => !isUnavailable(staff, dateInfo.date, dayName, ruleOverrides))
      .filter((staff) => !(staff.name === mioChefName && mioDays.has(dayName)))
      .filter((staff) => plannedCounts[staff.name] < getChefGtTarget(staff.name, mioChefName, gtTargetsByChef))
      .filter((staff) => canCoverSection(staff, 'Pass'))
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

function createFairnessContext(staff) {
  return {
    stats: Object.fromEntries(staff.map((member) => [member.name, {
      name: member.name,
      fridayCount: 0,
      saturdayCount: 0,
      sundayCount: 0,
      weightedBurden: 0,
      repeatedSaturdaySundayPairCount: 0,
      repeatedFullWeekendCount: 0,
      repeatedExactPatternCount: 0
    }])),
    previousWeekPatterns: {}
  };
}

function getFairnessProfile(name, dayName, fairnessContext, currentWeekDaysByChef) {
  if (!fairnessContext) {
    return {
      weightedBurden: 0,
      fridayCount: 0,
      saturdayCount: 0,
      sundayCount: 0,
      repeatedSaturdaySundayPair: 0,
      repeatedFullWeekend: 0,
      repeatedExactPattern: 0,
      overlapCount: 0
    };
  }

  const stats = fairnessContext.stats[name] || {
    weightedBurden: 0,
    fridayCount: 0,
    saturdayCount: 0,
    sundayCount: 0,
    repeatedSaturdaySundayPairCount: 0,
    repeatedFullWeekendCount: 0,
    repeatedExactPatternCount: 0
  };
  const previous = fairnessContext.previousWeekPatterns[name];
  const projectedDays = new Set([...(currentWeekDaysByChef?.[name] || []), dayName]);
  const projectedDayNames = WEEKDAYS.filter((item) => projectedDays.has(item));
  const signature = projectedDayNames.join('|');
  const repeatedSaturdaySundayPair = previous?.saturdaySundayPair && projectedDays.has('Saturday') && projectedDays.has('Sunday') ? 1 : 0;
  const repeatedFullWeekend = previous?.fullWeekend && projectedDays.has('Friday') && projectedDays.has('Saturday') && projectedDays.has('Sunday') ? 1 : 0;
  const repeatedExactPattern = previous?.signature === signature && projectedDayNames.length === (previous?.dayNames?.length || -1) ? 1 : 0;
  const overlapCount = previous?.dayNames?.filter((item) => projectedDays.has(item)).length || 0;

  return {
    weightedBurden: stats.weightedBurden,
    fridayCount: stats.fridayCount,
    saturdayCount: stats.saturdayCount,
    sundayCount: stats.sundayCount,
    repeatedSaturdaySundayPair,
    repeatedFullWeekend,
    repeatedExactPattern,
    overlapCount
  };
}

export function compareFairnessTieBreak(a, b, dayName, fairnessContext, currentWeekDaysByChef = {}) {
  if (!fairnessContext) return 0;
  const fairnessA = getFairnessProfile(a.name || a, dayName, fairnessContext, currentWeekDaysByChef);
  const fairnessB = getFairnessProfile(b.name || b, dayName, fairnessContext, currentWeekDaysByChef);

  const comparisons = [
    fairnessA.weightedBurden - fairnessB.weightedBurden,
    fairnessA.repeatedSaturdaySundayPair - fairnessB.repeatedSaturdaySundayPair,
    fairnessA.repeatedFullWeekend - fairnessB.repeatedFullWeekend,
    fairnessA.repeatedExactPattern - fairnessB.repeatedExactPattern,
    fairnessA.overlapCount - fairnessB.overlapCount
  ];

  if (dayName === 'Friday') comparisons.unshift(fairnessA.fridayCount - fairnessB.fridayCount);
  if (dayName === 'Saturday') comparisons.unshift(fairnessA.saturdayCount - fairnessB.saturdayCount);
  if (dayName === 'Sunday') comparisons.unshift(fairnessA.sundayCount - fairnessB.sundayCount);

  for (const comparison of comparisons) {
    if (comparison !== 0) return comparison;
  }

  return (a.name || a).localeCompare(b.name || b);
}

function updateFairnessContext(fairnessContext, rota) {
  if (!fairnessContext) return [];
  const weekDaysByChef = {};

  rota.forEach((day) => {
    day.chefs.forEach((chefName) => {
      if (!weekDaysByChef[chefName]) weekDaysByChef[chefName] = new Set();
      weekDaysByChef[chefName].add(day.dayName);
    });
  });

  Object.entries(fairnessContext.stats).forEach(([name, stats]) => {
    const dayNames = WEEKDAYS.filter((dayName) => weekDaysByChef[name]?.has(dayName));
    if (dayNames.includes('Friday')) stats.fridayCount += 1;
    if (dayNames.includes('Saturday')) stats.saturdayCount += 1;
    if (dayNames.includes('Sunday')) stats.sundayCount += 1;
    stats.weightedBurden += dayNames.reduce((total, dayName) => total + (DAY_FAIRNESS_WEIGHTS[dayName] || 0), 0);

    const previous = fairnessContext.previousWeekPatterns[name];
    const saturdaySundayPair = dayNames.includes('Saturday') && dayNames.includes('Sunday');
    const fullWeekend = dayNames.includes('Friday') && saturdaySundayPair;
    const signature = dayNames.join('|');

    if (previous?.saturdaySundayPair && saturdaySundayPair) stats.repeatedSaturdaySundayPairCount += 1;
    if (previous?.fullWeekend && fullWeekend) stats.repeatedFullWeekendCount += 1;
    if (previous?.signature && previous.signature === signature) stats.repeatedExactPatternCount += 1;

    fairnessContext.previousWeekPatterns[name] = {
      dayNames,
      saturdaySundayPair,
      fullWeekend,
      signature
    };
  });

  return Object.values(fairnessContext.stats).map((entry) => ({ ...entry }));
}

export function getSectionCandidateBaseScore({
  staff,
  section,
  dayName,
  ruleOverrides,
  gtDaysByChef,
  mioChefName,
  gtTargetsByChef,
  remainingAvailabilityByChef
}) {
  const sectionScore = sectionCandidateScore(staff, section);
  if (!Number.isFinite(sectionScore)) return Number.NEGATIVE_INFINITY;
  const gtTarget = getChefGtTarget(staff.name, mioChefName, gtTargetsByChef);
  const remainingTarget = Math.max(gtTarget - (gtDaysByChef[staff.name] || 0), 0);
  const remainingAvailability = remainingAvailabilityByChef?.[staff.name] ?? Number.POSITIVE_INFINITY;
  const urgency = remainingTarget * 2;
  const scarcityBoost = Number.isFinite(remainingAvailability)
    ? (remainingTarget / Math.max(remainingAvailability, 1)) * 6
    : 0;
  const mustUseBoost = remainingTarget > 0 && Number.isFinite(remainingAvailability) && remainingAvailability <= remainingTarget ? 200 : 0;
  const coverableCoreSectionCount = CORE_SECTIONS.filter((candidateSection) => canCoverSection(staff, candidateSection)).length;
  const specialistBoost = coverableCoreSectionCount > 0 ? (CORE_SECTIONS.length - coverableCoreSectionCount) * 4 : 0;
  const mioWeekendBoost = staff.name === mioChefName && ['Saturday', 'Sunday'].includes(dayName) ? 10 : 0;
  const passSenior = section === 'Pass' && PASS_DAYS.includes(dayName) && isSenior(staff) ? 120 : 0;
  return sectionScore
    + getRoleBonus(staff, dayName)
    + urgency
    + scarcityBoost
    + mustUseBoost
    + specialistBoost
    + mioWeekendBoost
    + passSenior
    - getSoftRulePenalty(staff.name, dayName)
    - (gtDaysByChef[staff.name] || 0);
}

function getExtraCandidateBaseScore({ staff, dayName, gtDaysByChef, mioChefName, gtTargetsByChef, remainingAvailabilityByChef }) {
  const gtTarget = getChefGtTarget(staff.name, mioChefName, gtTargetsByChef);
  const urgency = Math.max(gtTarget - (gtDaysByChef[staff.name] || 0), 0);
  const remainingAvailability = remainingAvailabilityByChef?.[staff.name] ?? Number.POSITIVE_INFINITY;
  const scarcityBoost = Number.isFinite(remainingAvailability)
    ? (urgency / Math.max(remainingAvailability, 1)) * 20
    : 0;
  const mustUseBoost = urgency > 0 && Number.isFinite(remainingAvailability) && remainingAvailability <= urgency ? 200 : 0;
  const seniorPenalty = isSenior(staff) ? 4 : 0;
  return (urgency * 20) + scarcityBoost + mustUseBoost + getRoleBonus(staff, dayName) - seniorPenalty - getSoftRulePenalty(staff.name, dayName);
}

function pickBestForSection({
  section,
  dayName,
  candidates,
  selectedNames,
  ruleOverrides,
  gtDaysByChef,
  mioChefName,
  gtTargetsByChef,
  remainingAvailabilityByChef,
  fairnessContext,
  currentWeekDaysByChef
}) {
  const sectionCandidates = candidates
    .filter((staff) => !selectedNames.has(staff.name))
    .filter((staff) => canCoverSection(staff, section))
    .sort((a, b) => {
      const scoreDiff = getSectionCandidateBaseScore({
        staff: b,
        section,
        dayName,
        ruleOverrides,
        gtDaysByChef,
        mioChefName,
        gtTargetsByChef,
        remainingAvailabilityByChef
      }) - getSectionCandidateBaseScore({
        staff: a,
        section,
        dayName,
        ruleOverrides,
        gtDaysByChef,
        mioChefName,
        gtTargetsByChef,
        remainingAvailabilityByChef
      });
      if (scoreDiff !== 0) return scoreDiff;
      return compareFairnessTieBreak(a, b, dayName, fairnessContext, currentWeekDaysByChef);
    });

  return sectionCandidates[0] || null;
}

function ensureSeniorCoverage({ assignments, dayName, candidates, selectedNames, ruleOverrides }) {
  const hasSenior = [...selectedNames].some((name) => isSenior(candidates.find((item) => item.name === name)));
  if (hasSenior) return;

  const replacementSeniors = candidates
    .filter((staff) => isSenior(staff))
    .filter((staff) => !selectedNames.has(staff.name))
    .sort((a, b) => getRoleBonus(b, dayName) - getRoleBonus(a, dayName));
  if (!replacementSeniors.length) return;

  let weakest = null;
  replacementSeniors.forEach((replacementSenior) => {
    assignments.forEach((assignment, index) => {
      if (!canCoverSection(replacementSenior, assignment.section)) return;
      const incumbent = candidates.find((item) => item.name === assignment.chef);
      if (!incumbent) return;
      const incumbentScore = getSectionScore(incumbent, assignment.section, ruleOverrides);
      const seniorScore = getSectionScore(replacementSenior, assignment.section, ruleOverrides);
      const degradation = incumbentScore - seniorScore;
      if (weakest === null || degradation < weakest.degradation) {
        weakest = { index, chef: incumbent.name, degradation, replacementSenior };
      }
    });
  });

  if (!weakest) return;
  assignments[weakest.index].chef = weakest.replacementSenior.name;
  selectedNames.delete(weakest.chef);
  selectedNames.add(weakest.replacementSenior.name);
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
  gtTargetsByChef,
  breakfastCounts,
  mioChefName,
  remainingAvailabilityByChef,
  forcedPassSeniorName,
  forcedChefName,
  fairnessContext,
  currentWeekDaysByChef
}) {
  if (requiredChefs < coreSections.length) return null;
  if (candidates.length < requiredChefs) return null;

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
      .filter((section) => canCoverSection(forced, section))
      .slice()
      .sort((a, b) => getSectionScore(forced, b, ruleOverrides) - getSectionScore(forced, a, ruleOverrides))[0];
    if (!bestSection) return null;
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
      gtTargetsByChef,
      remainingAvailabilityByChef,
      fairnessContext,
      currentWeekDaysByChef
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
        const scoreDiff = getExtraCandidateBaseScore({
          staff: b,
          dayName,
          gtDaysByChef,
          mioChefName,
          gtTargetsByChef,
          remainingAvailabilityByChef
        }) - getExtraCandidateBaseScore({
          staff: a,
          dayName,
          gtDaysByChef,
          mioChefName,
          gtTargetsByChef,
          remainingAvailabilityByChef
        });
        if (scoreDiff !== 0) return scoreDiff;
        return compareFairnessTieBreak(a, b, dayName, fairnessContext, currentWeekDaysByChef);
      })[0];

    if (!extra) return null;
    selectedNames.add(extra.name);
    assignments.push({ chef: extra.name, section: 'Float' });
  }

  const coreChefs = assignments
    .filter((assignment) => coreSections.includes(assignment.section))
    .map((assignment) => assignment.chef);
  const breakfastChef = coreChefs
    .map((name) => state.staff.find((staff) => staff.name === name))
    .filter((staff) => staff && staff.breakfastEligible && canCoverSection(staff, 'Breakfast'))
    .sort((a, b) => {
      const countA = breakfastCounts[a.name] || 0;
      const countB = breakfastCounts[b.name] || 0;
      if (countA !== countB) return countA - countB;
      return getSectionScore(b, 'Breakfast', ruleOverrides) - getSectionScore(a, 'Breakfast', ruleOverrides);
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

function getGtEligibleChefsForDay({ state, dayName, date, mioChefName, mioDays, mioGtDays, ruleOverrides, gtTargetsByChef }) {
  return state.staff.filter((staff) => {
    if (getChefGtTarget(staff.name, mioChefName, gtTargetsByChef) <= 0) return false;
    if (isUnavailable(staff, date, dayName, ruleOverrides)) return false;
    if (staff.name === mioChefName && mioDays.has(dayName)) return false;
    if (staff.name === mioChefName && !mioGtDays.has(dayName)) return false;
    return true;
  });
}

function buildDailyChefTargets({ state, dates, inputs, mioChefName, mioDays, mioGtDays, ruleOverrides, gtTargetsByChef }) {
  const dayPlans = dates.map(({ dayName, date }) => {
    const requiredChefs = getRequiredChefCount(dayName, inputs, date);
    const capacity = getGtEligibleChefsForDay({
      state,
      dayName,
      date,
      mioChefName,
      mioDays,
      mioGtDays,
      ruleOverrides,
      gtTargetsByChef
    }).length;
    return {
      dayName,
      date,
      requiredChefs,
      totalChefs: requiredChefs,
      capacity
    };
  });

  const minimumCover = dayPlans.reduce((sum, day) => sum + day.requiredChefs, 0);
  const totalTarget = Object.values(gtTargetsByChef).reduce((sum, count) => sum + count, 0);
  if (totalTarget < minimumCover) {
    return {
      ok: false,
      message: `Weekly GT targets total ${totalTarget}, but minimum cover requires ${minimumCover} GT assignments.`
    };
  }

  let remainingFloatSlots = totalTarget - minimumCover;
  while (remainingFloatSlots > 0) {
    const targetDay = dayPlans
      .filter((day) => FLOAT_PRIORITY_DAYS.includes(day.dayName))
      .filter((day) => day.totalChefs < day.capacity)
      .sort((a, b) => {
        const slackDiff = (b.capacity - b.totalChefs) - (a.capacity - a.totalChefs);
        if (slackDiff !== 0) return slackDiff;
        if (a.totalChefs !== b.totalChefs) return a.totalChefs - b.totalChefs;
        return FLOAT_PRIORITY_DAYS.indexOf(a.dayName) - FLOAT_PRIORITY_DAYS.indexOf(b.dayName);
      })[0];

    if (!targetDay) {
      return {
        ok: false,
        message: `Not enough Thursday-to-Sunday GT capacity to place ${remainingFloatSlots} remaining Float shift${remainingFloatSlots === 1 ? '' : 's'} and meet exact weekly targets.`
      };
    }

    targetDay.totalChefs += 1;
    remainingFloatSlots -= 1;
  }

  return {
    ok: true,
    dayPlans
  };
}

function buildPlanningOrder(dayPlans) {
  return dayPlans.slice().sort((a, b) => a.date.localeCompare(b.date));
}

function getRemainingAvailabilityByChef({ planningDays, state, mioChefName, mioDays, mioGtDays, ruleOverrides, gtTargetsByChef, completedDates }) {
  const remaining = {};
  state.staff.forEach((staff) => {
    remaining[staff.name] = planningDays.filter((day) => {
      if (completedDates.has(day.date)) return false;
      if (getChefGtTarget(staff.name, mioChefName, gtTargetsByChef) <= 0) return false;
      if (isUnavailable(staff, day.date, day.dayName, ruleOverrides)) return false;
      if (staff.name === mioChefName && mioDays.has(day.dayName)) return false;
      if (staff.name === mioChefName && !mioGtDays.has(day.dayName)) return false;
      return true;
    }).length;
  });
  return remaining;
}

function summarizeRota({ state, rota, mioChefName, annualLeaveHoursByChef, gtTargetsByChef }) {
  const gtDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const mioDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const gtHoursByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const mioHoursByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const floatDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  const currentWeekDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, new Set()]));

  rota.forEach((day) => {
    day.chefs.forEach((chefName) => {
      gtDaysByChef[chefName] += 1;
      gtHoursByChef[chefName] += getHoursForDay(day.dayName);
      currentWeekDaysByChef[chefName].add(day.dayName);
    });
    day.assignments.forEach((assignment) => {
      if (assignment.section === 'MIO') {
        mioDaysByChef[assignment.chef] += 1;
        mioHoursByChef[assignment.chef] += getHoursForAssignment(day.dayName, 'MIO');
      }
      if (assignment.section === 'Float') {
        floatDaysByChef[assignment.chef] += 1;
      }
    });
  });

  const summary = state.staff.map((staff) => {
    const totalCreditedHours = (gtHoursByChef[staff.name] || 0) + (mioHoursByChef[staff.name] || 0) + (annualLeaveHoursByChef[staff.name] || 0);
    return {
      name: staff.name,
      count: gtDaysByChef[staff.name] || 0,
      gtDays: gtDaysByChef[staff.name] || 0,
      adjustedGtTarget: getChefGtTarget(staff.name, mioChefName, gtTargetsByChef),
      mioDays: mioDaysByChef[staff.name] || 0,
      gtHours: gtHoursByChef[staff.name] || 0,
      mioHours: mioHoursByChef[staff.name] || 0,
      floatDays: floatDaysByChef[staff.name] || 0,
      annualLeaveHours: annualLeaveHoursByChef[staff.name] || 0,
      totalCreditedHours,
      hours: totalCreditedHours
    };
  });

  return {
    summary,
    gtDaysByChef,
    currentWeekDaysByChef
  };
}

export function buildRota(inputs, options = {}) {
  const state = getState();
  const dates = buildWeekDates(inputs.weekStart);
  // Preserve the requested Monday-to-Sunday horizon even if generation stops early.
  const fullWeekDates = dates.map((item) => item.date);
  const weekDateSet = new Set(dates.map((item) => item.date));
  const availability = getAvailabilityEntries(inputs, state);
  const ruleOverrides = { _availability: availability };
  const annualLeaveHoursByChef = getAnnualLeaveHoursByChef(state.staff, availability, weekDateSet);

  const mioChefName = inputs.mioChef;
  const mioChef = state.staff.find((staff) => staff.name === mioChefName);
  const mioDays = getMioDayPlan(state, dates, mioChefName, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible && mioDays.size !== 3) {
    return {
      status: 'infeasible',
      rota: [],
      validation: [{ day: 'Overall', message: `${mioChefName}: cannot place exactly 3 MIO shifts due to availability/unavailability constraints.`, severity: 'bad' }],
      summary: [],
      fullWeekDates
    };
  }

  const mioGtDayPlanOptions = getMioGtDayPlanOptions(state, dates, mioChefName, mioDays, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible && !mioGtDayPlanOptions.length) {
    return {
      status: 'infeasible',
      rota: [],
      validation: [{ day: 'Overall', message: `${mioChefName}: cannot place exactly 2 GT shifts on non-MIO days due to availability/unavailability constraints.`, severity: 'bad' }],
      summary: [],
      fullWeekDates
    };
  }

  const attemptPlans = mioGtDayPlanOptions.length ? mioGtDayPlanOptions : [new Set()];
  let attemptLevelFailure = null;

  for (let attemptIndex = 0; attemptIndex < attemptPlans.length; attemptIndex += 1) {
    const mioGtDays = attemptPlans[attemptIndex];
    const gtTargetsByChef = getAdjustedGtTargetsByChef({
      staff: state.staff,
      mioChefName,
      availability,
      weeklyDates: weekDateSet
    });
    const dailyChefTargets = buildDailyChefTargets({
      state,
      dates,
      inputs,
      mioChefName,
      mioDays,
      mioGtDays,
      ruleOverrides,
      gtTargetsByChef
    });
    if (!dailyChefTargets.ok) {
      attemptLevelFailure = dailyChefTargets.message;
      if (attemptIndex < attemptPlans.length - 1) continue;
      return {
        status: 'infeasible',
        rota: [],
        validation: [{ day: 'Overall', message: dailyChefTargets.message, severity: 'bad' }],
        summary: []
      };
    }

    const planningDays = buildPlanningOrder(dailyChefTargets.dayPlans);
    const gtDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
    const breakfastCounts = {};
    const currentWeekDaysByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, new Set()]));
    const completedDates = new Set();
    const validation = [];
    const rota = [];
    const forcedSeniorPassByDay = chooseSeniorPassPlan({ state, dates, ruleOverrides, mioChefName, mioDays, gtTargetsByChef });

    for (const { dayName, date, totalChefs } of planningDays) {
      const coreSections = getCoreSections(dayName, inputs);
      const remainingAvailabilityByChef = getRemainingAvailabilityByChef({
        planningDays,
        state,
        mioChefName,
        mioDays,
        mioGtDays,
        ruleOverrides,
        gtTargetsByChef,
        completedDates
      });
      const candidates = getGtEligibleChefsForDay({
        state,
        dayName,
        date,
        mioChefName,
        mioDays,
        mioGtDays,
        ruleOverrides,
        gtTargetsByChef
      }).filter((staff) => gtDaysByChef[staff.name] < getChefGtTarget(staff.name, mioChefName, gtTargetsByChef));

      const dayPlan = createDayPlan({
        state,
        dayName,
        date,
        requiredChefs: totalChefs,
        coreSections,
        ruleOverrides,
        candidates,
        gtDaysByChef,
        gtTargetsByChef,
        breakfastCounts,
        mioChefName,
        remainingAvailabilityByChef,
        forcedPassSeniorName: forcedSeniorPassByDay[dayName],
        forcedChefName: mioGtDays.has(dayName) ? mioChefName : null,
        fairnessContext: options.fairnessContext || null,
        currentWeekDaysByChef
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
        currentWeekDaysByChef[chefName].add(dayName);
      });

      if (mioChef && mioChef.mioEligible && mioDays.has(dayName) && !isUnavailable(mioChef, date, dayName, ruleOverrides)) {
        dayPlan.assignments.push({ chef: mioChefName, section: 'MIO' });
      }

      rota.push(dayPlan);
      completedDates.add(date);
    }

    rota.sort((a, b) => a.date.localeCompare(b.date));
    const { summary } = summarizeRota({
      state,
      rota,
      mioChefName,
      annualLeaveHoursByChef,
      gtTargetsByChef
    });

    const validationInputs = { ...inputs, availability };
    const hardValidation = validateRotaHardRules({ rota, state, inputs: validationInputs, summary, fullWeekDates });
    const hardFailures = hardValidation.filter((result) => !result.passed);
    const isFeasible = rota.length > 0 && !validation.some((item) => item.severity === 'bad') && hardFailures.length === 0;

    if (isFeasible) {
      return {
        status: 'ok',
        rota,
        validation,
        summary,
        fullWeekDates
      };
    }

    if (attemptIndex === attemptPlans.length - 1) {
      return {
        status: 'infeasible',
        rota,
        validation: validation.concat(hardFailures.map((result) => ({ day: 'Overall', message: `${result.ruleId}: ${result.message}`, severity: 'bad' }))),
        summary,
        fullWeekDates
      };
    }
  }

  return {
    status: 'infeasible',
    rota: [],
    validation: [{ day: 'Overall', message: attemptLevelFailure || 'Could not build a valid week plan with current hard constraints.', severity: 'bad' }],
    summary: [],
    fullWeekDates
  };
}

export function buildMultiWeekRota(inputs, legacyNumWeeks) {
  const state = getState();
  const numberOfWeeks = clampNumWeeks(inputs?.numWeeks ?? legacyNumWeeks ?? 1);
  const weeklyMioSelections = inputs?.weeklyMioSelections || {};
  const allAvailability = getAvailabilityEntries(inputs, state);
  const allAdditionalChefRequirements = inputs?.additionalChefRequirements || state.weeklyInputs.additionalChefRequirements || [];
  const fairnessApplied = numberOfWeeks > 1;
  const fairnessContext = fairnessApplied ? createFairnessContext(state.staff) : null;
  const weeks = [];

  for (let weekIndex = 0; weekIndex < numberOfWeeks; weekIndex += 1) {
    const weekStart = getWeekStartAtOffset(inputs.weekStart, weekIndex);
    const mioChef = numberOfWeeks === 1
      ? (inputs.mioChef || weeklyMioSelections[weekStart] || '')
      : (weeklyMioSelections[weekStart] || inputs.mioChef || '');
    const weekInputs = {
      ...inputs,
      weekStart,
      mioChef,
      availability: filterAvailabilityForWeek(allAvailability, weekStart),
      additionalChefRequirements: filterAdditionalChefRequirementsForWeek(allAdditionalChefRequirements, weekStart)
    };
    const weekResult = buildRota(weekInputs, { fairnessContext });
    const weekRecord = {
      weekIndex,
      weekNumber: weekIndex + 1,
      weekStart,
      mioChef,
      inputs: weekInputs,
      ...weekResult
    };
    weeks.push(weekRecord);

    if (weekResult.status !== 'ok') {
      return {
        status: 'infeasible',
        numberOfWeeks,
        failedWeek: weekIndex + 1,
        failedWeekStart: weekStart,
        weeks,
        validation: weekResult.validation || [],
        fairnessApplied,
        fairnessSummary: fairnessContext ? Object.values(fairnessContext.stats).map((entry) => ({ ...entry })) : []
      };
    }

    if (fairnessContext) updateFairnessContext(fairnessContext, weekResult.rota);
  }

  return {
    status: 'ok',
    numberOfWeeks,
    weeks,
    validation: [],
    fairnessApplied,
    fairnessSummary: fairnessContext ? Object.values(fairnessContext.stats).map((entry) => ({ ...entry })) : []
  };
}
