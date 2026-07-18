import { WEEKDAYS, DAY_FAIRNESS_WEIGHTS, SHIFT_LENGTHS, CORE_SECTIONS } from './constants.js';
import { getState } from './state.js';
import { parseLocalDate, toDateString, getWeekStartAtOffset, normalizeWeekStart } from './utils.js';
import {
  getSectionScore,
  getPreferredDayOffPenalty,
  isSenior,
  getHoursForDay,
  getHoursForAssignment,
  scoreSoftPreferences
} from './scoring.js';
import { canCoverSection, sectionCandidateScore } from './section-levels.js';
import {
  isUnavailable,
  getRequiredChefCount,
  getCoreSections,
  PRIMARY_GT_SECTIONS,
  validateRotaHardRules,
  getAdjustedGtTargetsByChef,
  getAnnualLeaveDatesByChef
} from './validation.js?v=20260718h';
import { filterAvailabilityForWeek, filterAdditionalChefRequirementsForWeek } from './weekly-inputs.js';

const PASS_DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIO_PRIMARY_DAYS = ['Monday', 'Tuesday', 'Wednesday'];
const MIO_FALLBACK_DAYS = ['Thursday', 'Friday'];
const MIO_GT_PRIMARY_DAYS = ['Saturday', 'Sunday'];
const MIO_GT_FALLBACK_DAYS = ['Thursday', 'Friday', 'Monday', 'Tuesday', 'Wednesday'];
const FLOAT_PRIORITY_DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SOLVER_ENGINE_VERSION = '2026-07-18-preferred-days-before-weekend-fairness';

export const SOLVER_SEARCH_LIMITS = Object.freeze({
  singleWeek: Object.freeze({
    initialCandidateCount: 3,
    maxOptimizationIterations: 8,
    maxNeighborEvaluationsPerIteration: 120
  }),
  multiWeek: Object.freeze({
    initialCandidateCount: 2,
    maxOptimizationIterations: 4,
    maxNeighborEvaluationsPerIteration: 72
  })
});

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
  const preferredDayOffA = Array.isArray(a?.preferredDaysOff) && a.preferredDaysOff.includes(dayName);
  const preferredDayOffB = Array.isArray(b?.preferredDaysOff) && b.preferredDaysOff.includes(dayName);
  if (preferredDayOffA !== preferredDayOffB) return preferredDayOffA ? 1 : -1;
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

  return String(a.id || a.name || a).localeCompare(String(b.id || b.name || b));
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
    + urgency
    + scarcityBoost
    + mustUseBoost
    + specialistBoost
    + mioWeekendBoost
    + passSenior
    - getPreferredDayOffPenalty(staff, dayName)
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
  return (urgency * 20) + scarcityBoost + mustUseBoost - seniorPenalty - getPreferredDayOffPenalty(staff, dayName);
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
    .sort((a, b) => String(a.id || a.name).localeCompare(String(b.id || b.name)));
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

export function selectBreakfastChef(candidates, dayName, breakfastCounts = {}) {
  return (candidates || [])
    .filter((staff) => staff?.breakfastEligible === true)
    .slice()
    .sort((a, b) => {
      const preferenceA = a.preferredBreakfast === dayName ? 1 : 0;
      const preferenceB = b.preferredBreakfast === dayName ? 1 : 0;
      if (preferenceA !== preferenceB) return preferenceB - preferenceA;
      const countA = breakfastCounts[a.name] || 0;
      const countB = breakfastCounts[b.name] || 0;
      if (countA !== countB) return countA - countB;
      return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''));
    })[0] || null;
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

  const breakfastCandidates = assignments
    .filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section))
    .map((assignment) => assignment.chef);
  const breakfastChef = selectBreakfastChef(
    breakfastCandidates.map((name) => state.staff.find((staff) => staff.name === name)),
    dayName,
    breakfastCounts
  );

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

function buildPlanningOrder(dayPlans, variantIndex = 0) {
  if (variantIndex % 3 === 1) {
    return dayPlans.slice().sort((a, b) => b.date.localeCompare(a.date));
  }
  if (variantIndex % 3 === 2) {
    const priority = ['Saturday', 'Sunday', 'Friday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday'];
    return dayPlans.slice().sort((a, b) => priority.indexOf(a.dayName) - priority.indexOf(b.dayName));
  }
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

function getSearchLimits(options = {}) {
  const defaults = options.multiWeekMode ? SOLVER_SEARCH_LIMITS.multiWeek : SOLVER_SEARCH_LIMITS.singleWeek;
  const overrides = options.searchLimits || {};
  const readLimit = (key, minimum, maximum) => {
    const parsed = Number.parseInt(overrides[key], 10);
    const value = Number.isFinite(parsed) ? parsed : defaults[key];
    return Math.max(minimum, Math.min(maximum, value));
  };
  return {
    initialCandidateCount: readLimit('initialCandidateCount', 1, 6),
    maxOptimizationIterations: readLimit('maxOptimizationIterations', 0, 20),
    maxNeighborEvaluationsPerIteration: readLimit('maxNeighborEvaluationsPerIteration', 1, 500)
  };
}

function getRotaSignature(rota) {
  return rota
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const chefs = day.chefs.slice().sort().join(',');
      const assignments = day.assignments
        .map((assignment) => `${assignment.section}:${assignment.chef}`)
        .sort()
        .join(',');
      return `${day.date}[${chefs}](${assignments})`;
    })
    .join('|');
}

export function cloneRotaCandidate(rota) {
  return (rota || []).map((day) => ({
    ...day,
    chefs: [...day.chefs],
    assignments: day.assignments.map((assignment) => ({ ...assignment }))
  }));
}

function getBreakfastMetrics(rota, state) {
  const counts = {};
  let preferenceScore = 0;

  (rota || []).forEach((day) => {
    const breakfast = day.assignments.find((assignment) => assignment.section === 'Breakfast');
    if (!breakfast) return;
    counts[breakfast.chef] = (counts[breakfast.chef] || 0) + 1;
    const chef = state.staff.find((candidate) => candidate.name === breakfast.chef);
    if (chef?.preferredBreakfast === day.dayName) preferenceScore += 1;
  });

  const assignedDays = Object.values(counts).reduce((total, count) => total + count, 0);
  const distinctChefs = Object.keys(counts).length;
  return {
    preferenceScore,
    counts,
    distinctChefs,
    repeatedAssignments: assignedDays - distinctChefs
  };
}

function getEligibleBreakfastChefNames(day, state) {
  const workingPrimaryChefs = new Set(
    day.assignments
      .filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section))
      .map((assignment) => assignment.chef)
      .filter((name) => day.chefs.includes(name))
  );

  return state.staff
    .filter((chef) => chef.breakfastEligible === true && workingPrimaryChefs.has(chef.name))
    .map((chef) => chef.name)
    .sort((a, b) => a.localeCompare(b));
}

function setSingleBreakfastAssignment(day, chefName) {
  let breakfastSeen = false;
  const assignments = day.assignments
    .map((assignment) => {
      if (assignment.section !== 'Breakfast') return assignment;
      if (breakfastSeen) return null;
      breakfastSeen = true;
      return { ...assignment, chef: chefName };
    })
    .filter(Boolean);

  if (!breakfastSeen) {
    const mioIndex = assignments.findIndex((assignment) => assignment.section === 'MIO');
    const insertionIndex = mioIndex >= 0 ? mioIndex : assignments.length;
    assignments.splice(insertionIndex, 0, { chef: chefName, section: 'Breakfast' });
  }
  day.assignments = assignments;
}

// Breakfast is an overlay on an already-built GT week, so its complete feasible
// search space can be optimized independently without changing days or sections.
// The seven-day matching pass maximizes matched preferences first, then keeps
// the widest possible rotation and minimizes unnecessary churn.
export function optimizeBreakfastAssignments({ rota, state }) {
  const optimizedRota = cloneRotaCandidate(rota);
  const before = getBreakfastMetrics(optimizedRota, state);
  const orderedDays = optimizedRota
    .map((day, index) => ({
      day,
      index,
      eligibleChefNames: getEligibleBreakfastChefNames(day, state),
      initialChef: day.assignments.find((assignment) => assignment.section === 'Breakfast')?.chef || ''
    }))
    .sort((a, b) => a.day.date.localeCompare(b.day.date));

  if (orderedDays.some((item) => item.eligibleChefNames.length === 0)) {
    return {
      rota: optimizedRota,
      feasible: false,
      changedDays: [],
      preferenceScoreBefore: before.preferenceScore,
      preferenceScoreAfter: before.preferenceScore,
      fairnessRepeatsBefore: before.repeatedAssignments,
      fairnessRepeatsAfter: before.repeatedAssignments
    };
  }

  const initialChefSet = new Set(orderedDays.map((item) => item.initialChef).filter(Boolean));
  orderedDays.forEach((item) => {
    const matchingPreferenceChefs = item.eligibleChefNames.filter((chefName) => (
      state.staff.find((chef) => chef.name === chefName)?.preferredBreakfast === item.day.dayName
    ));
    item.allowedChefNames = matchingPreferenceChefs.length
      ? matchingPreferenceChefs
      : item.eligibleChefNames;
  });

  const displacedInitialChefs = new Set(
    orderedDays
      .filter((item) => item.initialChef && !item.allowedChefNames.includes(item.initialChef))
      .map((item) => item.initialChef)
  );
  orderedDays.forEach((item) => {
    item.allowedChefNames = item.allowedChefNames.slice().sort((a, b) => {
      const currentDiff = Number(b === item.initialChef) - Number(a === item.initialChef);
      if (currentDiff !== 0) return currentDiff;
      const displacedDiff = Number(displacedInitialChefs.has(b)) - Number(displacedInitialChefs.has(a));
      if (displacedDiff !== 0) return displacedDiff;
      const existingDiff = Number(initialChefSet.has(b)) - Number(initialChefSet.has(a));
      return existingDiff || a.localeCompare(b);
    });
  });

  const matchingOrder = orderedDays
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (
      a.item.allowedChefNames.length - b.item.allowedChefNames.length
      || a.item.day.date.localeCompare(b.item.day.date)
    ))
    .map((entry) => entry.index);
  const chefToDay = new Map();

  function assignDistinctChef(dayIndex, visitedChefs) {
    const item = orderedDays[dayIndex];
    for (const chefName of item.allowedChefNames) {
      if (visitedChefs.has(chefName)) continue;
      visitedChefs.add(chefName);
      const occupiedDayIndex = chefToDay.get(chefName);
      if (occupiedDayIndex === undefined || assignDistinctChef(occupiedDayIndex, visitedChefs)) {
        chefToDay.set(chefName, dayIndex);
        return true;
      }
    }
    return false;
  }

  matchingOrder.forEach((dayIndex) => {
    assignDistinctChef(dayIndex, new Set());
  });

  const assignedChefByDay = new Map();
  chefToDay.forEach((dayIndex, chefName) => assignedChefByDay.set(dayIndex, chefName));
  const breakfastCounts = {};
  assignedChefByDay.forEach((chefName) => {
    breakfastCounts[chefName] = (breakfastCounts[chefName] || 0) + 1;
  });
  matchingOrder.forEach((dayIndex) => {
    if (assignedChefByDay.has(dayIndex)) return;
    const item = orderedDays[dayIndex];
    const chefName = item.allowedChefNames.slice().sort((a, b) => {
      const countDiff = (breakfastCounts[a] || 0) - (breakfastCounts[b] || 0);
      if (countDiff !== 0) return countDiff;
      const currentDiff = Number(b === item.initialChef) - Number(a === item.initialChef);
      if (currentDiff !== 0) return currentDiff;
      const displacedDiff = Number(displacedInitialChefs.has(b)) - Number(displacedInitialChefs.has(a));
      return displacedDiff || a.localeCompare(b);
    })[0];
    assignedChefByDay.set(dayIndex, chefName);
    breakfastCounts[chefName] = (breakfastCounts[chefName] || 0) + 1;
  });

  const changedDays = [];
  orderedDays.forEach((item, index) => {
    const chefName = assignedChefByDay.get(index);
    if (chefName !== item.initialChef) {
      changedDays.push({
        dayName: item.day.dayName,
        from: item.initialChef,
        to: chefName
      });
    }
    setSingleBreakfastAssignment(optimizedRota[item.index], chefName);
  });
  const after = getBreakfastMetrics(optimizedRota, state);

  return {
    rota: optimizedRota,
    feasible: true,
    changedDays,
    preferenceScoreBefore: before.preferenceScore,
    preferenceScoreAfter: after.preferenceScore,
    fairnessRepeatsBefore: before.repeatedAssignments,
    fairnessRepeatsAfter: after.repeatedAssignments
  };
}

function getStaffOrder(state) {
  return new Map(state.staff.map((chef, index) => [chef.name, index]));
}

function sortChefNames(names, state) {
  const staffOrder = getStaffOrder(state);
  return [...names].sort((a, b) => {
    const orderDiff = (staffOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (staffOrder.get(b) ?? Number.MAX_SAFE_INTEGER);
    return orderDiff || a.localeCompare(b);
  });
}

function rebuildDayAssignments({ day, state, inputs, breakfastCounts }) {
  const selectedChefNames = [...new Set(day.chefs)];
  const selectedChefs = selectedChefNames
    .map((name) => state.staff.find((chef) => chef.name === name))
    .filter(Boolean);
  const coreSections = getCoreSections(day.dayName, inputs);
  if (selectedChefs.length !== selectedChefNames.length || selectedChefs.length < coreSections.length) return null;

  const eligibleBySection = Object.fromEntries(coreSections.map((section) => [
    section,
    selectedChefs
      .filter((chef) => canCoverSection(chef, section))
      .sort((a, b) => a.name.localeCompare(b.name))
  ]));
  if (coreSections.some((section) => eligibleBySection[section].length === 0)) return null;

  const sectionOrder = coreSections.slice().sort((a, b) => {
    const scarcityDiff = eligibleBySection[a].length - eligibleBySection[b].length;
    return scarcityDiff || coreSections.indexOf(a) - coreSections.indexOf(b);
  });
  let best = null;
  const assignedBySection = {};
  const usedNames = new Set();

  function search(sectionIndex, localScore) {
    if (sectionIndex === sectionOrder.length) {
      const coreChefNames = coreSections.map((section) => assignedBySection[section]);
      const hasBreakfastChef = selectedChefs.some((chef) => chef.breakfastEligible === true);
      if (!hasBreakfastChef) return;
      const signature = coreChefNames.join('|');
      if (!best || localScore > best.score || (localScore === best.score && signature.localeCompare(best.signature) < 0)) {
        best = {
          score: localScore,
          signature,
          assignedBySection: { ...assignedBySection }
        };
      }
      return;
    }

    const section = sectionOrder[sectionIndex];
    eligibleBySection[section].forEach((chef) => {
      if (usedNames.has(chef.name)) return;
      assignedBySection[section] = chef.name;
      usedNames.add(chef.name);
      const seniorPassBonus = section === 'Pass' && isSenior(chef) ? 12 : 0;
      search(sectionIndex + 1, localScore + (getSectionScore(chef, section, {}) * 4) + seniorPassBonus);
      usedNames.delete(chef.name);
      delete assignedBySection[section];
    });
  }

  search(0, 0);
  if (!best) return null;

  const coreAssignments = coreSections.map((section) => ({
    chef: best.assignedBySection[section],
    section
  }));
  const coreChefNames = new Set(coreAssignments.map((assignment) => assignment.chef));
  const floatAssignments = sortChefNames(
    selectedChefNames.filter((name) => !coreChefNames.has(name)),
    state
  ).map((chef) => ({ chef, section: 'Float' }));
  const breakfastChef = selectBreakfastChef(
    [...coreAssignments, ...floatAssignments].map((assignment) => state.staff.find((chef) => chef.name === assignment.chef)),
    day.dayName,
    breakfastCounts
  );
  if (!breakfastChef) return null;

  const mioAssignments = day.assignments
    .filter((assignment) => assignment.section === 'MIO')
    .map((assignment) => ({ ...assignment }));
  return {
    ...day,
    chefs: sortChefNames(selectedChefNames, state),
    assignments: [
      ...coreAssignments,
      ...floatAssignments,
      { chef: breakfastChef.name, section: 'Breakfast' },
      ...mioAssignments
    ]
  };
}

export function rebuildAffectedDayAssignments({ rota, dayIndexes, state, inputs }) {
  const rebuilt = cloneRotaCandidate(rota);
  const affectedIndexes = [...new Set(dayIndexes)].sort((a, b) => a - b);
  const affectedIndexSet = new Set(affectedIndexes);
  const breakfastCounts = {};

  rebuilt.forEach((day, index) => {
    if (affectedIndexSet.has(index)) return;
    const breakfast = day.assignments.find((assignment) => assignment.section === 'Breakfast');
    if (breakfast) breakfastCounts[breakfast.chef] = (breakfastCounts[breakfast.chef] || 0) + 1;
  });

  for (const dayIndex of affectedIndexes) {
    const rebuiltDay = rebuildDayAssignments({
      day: rebuilt[dayIndex],
      state,
      inputs,
      breakfastCounts
    });
    if (!rebuiltDay) return null;
    rebuilt[dayIndex] = rebuiltDay;
    const breakfast = rebuiltDay.assignments.find((assignment) => assignment.section === 'Breakfast');
    if (breakfast) breakfastCounts[breakfast.chef] = (breakfastCounts[breakfast.chef] || 0) + 1;
  }

  return rebuilt;
}

export function hardValidateRotaCandidate({ rota, state, inputs, fullWeekDates }) {
  const availability = getAvailabilityEntries(inputs, state);
  const weekDateSet = new Set(fullWeekDates);
  const annualLeaveHoursByChef = getAnnualLeaveHoursByChef(state.staff, availability, weekDateSet);
  const gtTargetsByChef = getAdjustedGtTargetsByChef({
    staff: state.staff,
    mioChefName: inputs.mioChef,
    availability,
    weeklyDates: weekDateSet
  });
  const { summary } = summarizeRota({
    state,
    rota,
    mioChefName: inputs.mioChef,
    annualLeaveHoursByChef,
    gtTargetsByChef
  });
  const hardValidation = validateRotaHardRules({
    rota,
    state,
    inputs: { ...inputs, availability },
    summary,
    fullWeekDates
  });
  return {
    valid: hardValidation.every((result) => result.passed),
    hardValidation,
    summary
  };
}

function addUniqueNeighbor({ neighbors, seen, rota, move, limit }) {
  if (!rota || neighbors.length >= limit) return;
  const signature = getRotaSignature(rota);
  if (seen.has(signature)) return;
  seen.add(signature);
  neighbors.push({ rota, move, signature });
}

function buildChefDaySwap({ rota, sourceIndex, targetIndex, sourceChef, targetChef, state, inputs }) {
  const swapped = cloneRotaCandidate(rota);
  swapped[sourceIndex].chefs = swapped[sourceIndex].chefs.map((name) => name === sourceChef ? targetChef : name);
  swapped[targetIndex].chefs = swapped[targetIndex].chefs.map((name) => name === targetChef ? sourceChef : name);
  return rebuildAffectedDayAssignments({
    rota: swapped,
    dayIndexes: [sourceIndex, targetIndex],
    state,
    inputs
  });
}

export function generateNeighborCandidates({
  rota,
  state,
  inputs,
  limit = SOLVER_SEARCH_LIMITS.singleWeek.maxNeighborEvaluationsPerIteration
}) {
  const neighbors = [];
  const seen = new Set([getRotaSignature(rota)]);
  const orderedDayIndexes = rota
    .map((day, index) => ({ index, date: day.date }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => item.index);

  // Preferred-day repairs are evaluated first so the bounded search reaches the
  // most visible compromises even when the general swap space is large.
  orderedDayIndexes.forEach((sourceIndex) => {
    const sourceDay = rota[sourceIndex];
    sourceDay.chefs.slice().sort().forEach((sourceChefName) => {
      if (sourceChefName === inputs.mioChef) return;
      const sourceChef = state.staff.find((chef) => chef.name === sourceChefName);
      if (!sourceChef?.preferredDaysOff?.includes(sourceDay.dayName)) return;
      orderedDayIndexes.forEach((targetIndex) => {
        if (targetIndex === sourceIndex || neighbors.length >= limit) return;
        const targetDay = rota[targetIndex];
        if (targetDay.chefs.includes(sourceChefName) || sourceChef.preferredDaysOff.includes(targetDay.dayName)) return;
        targetDay.chefs.slice().sort().forEach((targetChefName) => {
          if (neighbors.length >= limit || targetChefName === inputs.mioChef || sourceDay.chefs.includes(targetChefName)) return;
          addUniqueNeighbor({
            neighbors,
            seen,
            rota: buildChefDaySwap({
              rota,
              sourceIndex,
              targetIndex,
              sourceChef: sourceChefName,
              targetChef: targetChefName,
              state,
              inputs
            }),
            move: `swap-days:${sourceChefName}:${sourceDay.dayName}<->${targetChefName}:${targetDay.dayName}`,
            limit
          });
        });
      });
    });
  });

  orderedDayIndexes.forEach((dayIndex) => {
    if (neighbors.length >= limit) return;
    addUniqueNeighbor({
      neighbors,
      seen,
      rota: rebuildAffectedDayAssignments({ rota, dayIndexes: [dayIndex], state, inputs }),
      move: `rebuild-day:${rota[dayIndex].dayName}`,
      limit
    });
  });

  orderedDayIndexes.forEach((dayIndex) => {
    if (neighbors.length >= limit) return;
    const day = rota[dayIndex];
    const primaryAssignments = day.assignments.filter((assignment) => CORE_SECTIONS.includes(assignment.section));
    for (let left = 0; left < primaryAssignments.length; left += 1) {
      for (let right = left + 1; right < primaryAssignments.length; right += 1) {
        if (neighbors.length >= limit) break;
        const first = primaryAssignments[left];
        const second = primaryAssignments[right];
        const firstChef = state.staff.find((chef) => chef.name === first.chef);
        const secondChef = state.staff.find((chef) => chef.name === second.chef);
        if (!canCoverSection(firstChef, second.section) || !canCoverSection(secondChef, first.section)) continue;
        const swapped = cloneRotaCandidate(rota);
        const dayAssignments = swapped[dayIndex].assignments;
        dayAssignments.find((assignment) => assignment.section === first.section).chef = second.chef;
        dayAssignments.find((assignment) => assignment.section === second.section).chef = first.chef;
        addUniqueNeighbor({
          neighbors,
          seen,
          rota: swapped,
          move: `swap-sections:${day.dayName}:${first.section}<->${second.section}`,
          limit
        });
      }
    }

  });

  for (let leftDay = 0; leftDay < orderedDayIndexes.length; leftDay += 1) {
    for (let rightDay = leftDay + 1; rightDay < orderedDayIndexes.length; rightDay += 1) {
      if (neighbors.length >= limit) break;
      const sourceIndex = orderedDayIndexes[leftDay];
      const targetIndex = orderedDayIndexes[rightDay];
      const sourceDay = rota[sourceIndex];
      const targetDay = rota[targetIndex];
      const sourceOnly = sourceDay.chefs.filter((name) => !targetDay.chefs.includes(name)).sort();
      const targetOnly = targetDay.chefs.filter((name) => !sourceDay.chefs.includes(name)).sort();
      sourceOnly.forEach((sourceChef) => {
        if (sourceChef === inputs.mioChef) return;
        targetOnly.forEach((targetChef) => {
          if (neighbors.length >= limit || targetChef === inputs.mioChef) return;
          addUniqueNeighbor({
            neighbors,
            seen,
            rota: buildChefDaySwap({
              rota,
              sourceIndex,
              targetIndex,
              sourceChef,
              targetChef,
              state,
              inputs
            }),
            move: `swap-days:${sourceChef}:${sourceDay.dayName}<->${targetChef}:${targetDay.dayName}`,
            limit
          });
        });
      });
    }
  }

  return neighbors;
}

function evaluateCompleteRotaCandidate({ rota, state, inputs, fullWeekDates, fairnessContext }) {
  const breakfastOptimization = optimizeBreakfastAssignments({ rota, state });
  const hardResult = hardValidateRotaCandidate({
    rota: breakfastOptimization.rota,
    state,
    inputs,
    fullWeekDates
  });
  const softScore = scoreSoftPreferences({
    state,
    rota: breakfastOptimization.rota,
    hardValidation: hardResult.hardValidation,
    fairnessContext
  });
  return {
    rota: breakfastOptimization.rota,
    signature: getRotaSignature(breakfastOptimization.rota),
    valid: hardResult.valid,
    hardValidation: hardResult.hardValidation,
    summary: hardResult.summary,
    softScore,
    breakfastOptimization
  };
}

export function compareCompleteRotaCandidates(a, b) {
  if (a.valid !== b.valid) return a.valid ? -1 : 1;
  // Soft preferences are compared lexicographically. This prevents any size of
  // weekend-fairness improvement from compensating for an additional Preferred
  // Day Off violation, while still allowing hard-valid rotas to override one.
  const preferredViolationsA = a.softScore.preferredDayOffViolationCount || 0;
  const preferredViolationsB = b.softScore.preferredDayOffViolationCount || 0;
  if (preferredViolationsA !== preferredViolationsB) return preferredViolationsA - preferredViolationsB;
  const preferredPenaltyA = a.softScore.preferredDayOffPenalty || 0;
  const preferredPenaltyB = b.softScore.preferredDayOffPenalty || 0;
  if (preferredPenaltyA !== preferredPenaltyB) return preferredPenaltyA - preferredPenaltyB;
  const fairnessPenaltyA = a.softScore.weekendFairnessPenalty || 0;
  const fairnessPenaltyB = b.softScore.weekendFairnessPenalty || 0;
  if (fairnessPenaltyA !== fairnessPenaltyB) return fairnessPenaltyA - fairnessPenaltyB;
  if (a.softScore.score !== b.softScore.score) return b.softScore.score - a.softScore.score;
  return a.signature.localeCompare(b.signature);
}

export function optimizeRotaCandidate({
  rota,
  state,
  inputs,
  fullWeekDates,
  fairnessContext = null,
  limits = SOLVER_SEARCH_LIMITS.singleWeek
}) {
  let current = evaluateCompleteRotaCandidate({ rota, state, inputs, fullWeekDates, fairnessContext });
  let acceptedMoves = 0;
  let neighborEvaluations = 0;
  const acceptedMoveDescriptions = [];
  let iterationsRun = 0;

  for (let iteration = 0; iteration < limits.maxOptimizationIterations; iteration += 1) {
    iterationsRun += 1;
    const neighbors = generateNeighborCandidates({
      rota: current.rota,
      state,
      inputs,
      limit: limits.maxNeighborEvaluationsPerIteration
    });
    let bestImprovement = null;
    let bestMove = '';

    neighbors.forEach((neighbor) => {
      neighborEvaluations += 1;
      const evaluated = evaluateCompleteRotaCandidate({
        rota: neighbor.rota,
        state,
        inputs,
        fullWeekDates,
        fairnessContext
      });
      if (!evaluated.valid || compareCompleteRotaCandidates(evaluated, current) >= 0) return;
      if (!bestImprovement || compareCompleteRotaCandidates(evaluated, bestImprovement) < 0) {
        bestImprovement = evaluated;
        bestMove = neighbor.move;
      }
    });

    if (!bestImprovement) break;
    current = bestImprovement;
    acceptedMoves += 1;
    acceptedMoveDescriptions.push(bestMove);
  }

  return {
    ...current,
    optimization: {
      acceptedMoves,
      acceptedMoveDescriptions,
      iterationsRun,
      neighborEvaluations
    }
  };
}

function buildGreedyCandidate({
  state,
  inputs,
  dates,
  fullWeekDates,
  weekDateSet,
  availability,
  ruleOverrides,
  annualLeaveHoursByChef,
  mioChefName,
  mioChef,
  mioDays,
  mioGtDays,
  planningVariant,
  fairnessContext
}) {
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
    return {
      status: 'infeasible',
      rota: [],
      summary: [],
      validation: [{ day: 'Overall', message: dailyChefTargets.message, severity: 'bad' }]
    };
  }

  const planningDays = buildPlanningOrder(dailyChefTargets.dayPlans, planningVariant);
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
      fairnessContext,
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
  const hardValidation = validateRotaHardRules({
    rota,
    state,
    inputs: { ...inputs, availability },
    summary,
    fullWeekDates
  });
  const hardFailures = hardValidation.filter((result) => !result.passed);
  const isFeasible = rota.length > 0
    && !validation.some((item) => item.severity === 'bad')
    && hardFailures.length === 0;

  return {
    status: isFeasible ? 'ok' : 'infeasible',
    rota,
    summary,
    hardValidation,
    validation: isFeasible
      ? validation
      : validation.concat(hardFailures.map((result) => ({
        day: 'Overall',
        message: `${result.ruleId}: ${result.message}`,
        severity: 'bad'
      })))
  };
}

export function buildRota(inputs, options = {}) {
  const state = getState();
  const dates = buildWeekDates(inputs.weekStart);
  // Preserve the requested Monday-to-Sunday horizon even if generation stops early.
  const fullWeekDates = dates.map((item) => item.date);
  const weekDateSet = new Set(fullWeekDates);
  const availability = getAvailabilityEntries(inputs, state);
  const normalizedInputs = { ...inputs, availability };
  const ruleOverrides = { _availability: availability };
  const annualLeaveHoursByChef = getAnnualLeaveHoursByChef(state.staff, availability, weekDateSet);
  const limits = getSearchLimits(options);

  const mioChefName = inputs.mioChef;
  const mioChef = state.staff.find((staff) => staff.name === mioChefName);
  if (mioChefName && !mioChef) {
    const message = `${mioChefName}: selected MIO chef is not in the current staff list.`;
    return {
      status: 'infeasible',
      rota: [],
      validation: [{ day: 'Overall', message, severity: 'bad' }],
      hardValidation: [{ ruleId: 'H032', passed: false, severity: 'hard', message }],
      summary: [],
      fullWeekDates
    };
  }
  if (mioChefName && !mioChef.mioEligible) {
    const message = `${mioChefName}: selected MIO chef is not eligible for MIO duty.`;
    return {
      status: 'infeasible',
      rota: [],
      validation: [{ day: 'Overall', message, severity: 'bad' }],
      hardValidation: [{ ruleId: 'H032', passed: false, severity: 'hard', message }],
      summary: [],
      fullWeekDates
    };
  }
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
  const optimizedCandidates = [];
  let lastFailure = null;

  for (let variantIndex = 0; variantIndex < limits.initialCandidateCount; variantIndex += 1) {
    let feasibleCandidate = null;
    for (let offset = 0; offset < attemptPlans.length; offset += 1) {
      const planIndex = offset;
      const greedyCandidate = buildGreedyCandidate({
        state,
        inputs: normalizedInputs,
        dates,
        fullWeekDates,
        weekDateSet,
        availability,
        ruleOverrides,
        annualLeaveHoursByChef,
        mioChefName,
        mioChef,
        mioDays,
        mioGtDays: attemptPlans[planIndex],
        planningVariant: variantIndex,
        fairnessContext: options.fairnessContext || null
      });
      if (greedyCandidate.status === 'ok') {
        feasibleCandidate = greedyCandidate;
        break;
      }
      lastFailure = greedyCandidate;
    }

    if (!feasibleCandidate) continue;
    const initialEvaluation = evaluateCompleteRotaCandidate({
      rota: feasibleCandidate.rota,
      state,
      inputs: normalizedInputs,
      fullWeekDates,
      fairnessContext: options.fairnessContext || null
    });
    const optimized = optimizeRotaCandidate({
      rota: feasibleCandidate.rota,
      state,
      inputs: normalizedInputs,
      fullWeekDates,
      fairnessContext: options.fairnessContext || null,
      limits
    });
    optimizedCandidates.push({
      ...optimized,
      initialSoftScore: initialEvaluation.softScore.score,
      initialPreferredDayOffViolationCount: initialEvaluation.softScore.preferredDayOffViolationCount,
      initialWeekendFairnessPenalty: initialEvaluation.softScore.weekendFairnessPenalty,
      planningVariant: variantIndex
    });
  }

  if (!optimizedCandidates.length) {
    return {
      status: 'infeasible',
      rota: lastFailure?.rota || [],
      validation: lastFailure?.validation || [{ day: 'Overall', message: 'Could not build a valid week plan with current hard constraints.', severity: 'bad' }],
      summary: lastFailure?.summary || [],
      fullWeekDates
    };
  }

  const firstInitialSoftScore = optimizedCandidates[0].initialSoftScore;
  const firstInitialPreferredDayOffViolationCount = optimizedCandidates[0].initialPreferredDayOffViolationCount;
  const firstInitialWeekendFairnessPenalty = optimizedCandidates[0].initialWeekendFairnessPenalty;
  optimizedCandidates.sort(compareCompleteRotaCandidates);
  const best = optimizedCandidates[0];
  const initialSoftScore = firstInitialSoftScore;
  const totalNeighborEvaluations = optimizedCandidates.reduce((total, candidate) => total + candidate.optimization.neighborEvaluations, 0);
  const optimizationDiagnostics = {
    initialSoftScore,
    finalSoftScore: best.softScore.score,
    initialPreferredDayOffViolationCount: firstInitialPreferredDayOffViolationCount,
    finalPreferredDayOffViolationCount: best.softScore.preferredDayOffViolationCount,
    initialWeekendFairnessPenalty: firstInitialWeekendFairnessPenalty,
    finalWeekendFairnessPenalty: best.softScore.weekendFairnessPenalty,
    candidateRotasEvaluated: optimizedCandidates.length,
    acceptedOptimizationMoves: best.optimization.acceptedMoves,
    winningCandidateIterations: best.optimization.iterationsRun,
    neighborCandidatesEvaluated: totalNeighborEvaluations,
    improvedFromInitial: best.softScore.preferredDayOffViolationCount < firstInitialPreferredDayOffViolationCount
      || (
        best.softScore.preferredDayOffViolationCount === firstInitialPreferredDayOffViolationCount
        && (
          best.softScore.weekendFairnessPenalty < firstInitialWeekendFairnessPenalty
          || (
            best.softScore.weekendFairnessPenalty === firstInitialWeekendFairnessPenalty
            && best.softScore.score > initialSoftScore
          )
        )
      ),
    limits: { ...limits }
  };

  return {
    status: 'ok',
    rota: best.rota,
    validation: [],
    hardValidation: best.hardValidation,
    softScore: best.softScore,
    summary: best.summary,
    fullWeekDates,
    optimizationDiagnostics
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
    const hasWeeklySelection = Object.prototype.hasOwnProperty.call(weeklyMioSelections, weekStart);
    const mioChef = hasWeeklySelection
      ? (weeklyMioSelections[weekStart] || '')
      : (inputs.mioChef || '');
    const weekInputs = {
      ...inputs,
      weekStart,
      mioChef,
      availability: filterAvailabilityForWeek(allAvailability, weekStart),
      additionalChefRequirements: filterAdditionalChefRequirementsForWeek(allAdditionalChefRequirements, weekStart)
    };
    const weekResult = buildRota(weekInputs, {
      fairnessContext,
      multiWeekMode: numberOfWeeks > 1
    });
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
