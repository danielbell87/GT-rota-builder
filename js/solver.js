import { WEEKDAYS } from './constants.js';
import { getState } from './state.js';
import { parseLocalDate } from './utils.js';
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

export const SOLVER_ENGINE_VERSION = '2026-07-16-multi-week-rota';

// Bias applied per GT day the chef with the most prior-week GT days worked more than a candidate.
// Small enough to not override section skill differences, but enough to break ties fairly.
const CROSS_WEEK_BIAS_WEIGHT = 0.5;

function getGtTargetForChef(chefName, mioChefName) {
  return chefName === mioChefName ? 2 : 4;
}

function getCrossWeekBias(name, priorGtDays, maxPrior) {
  // Returns 0 when no prior history exists (maxPrior === 0), which is the correct default.
  if (maxPrior === 0) return 0;
  return (maxPrior - ((priorGtDays || {})[name] || 0)) * CROSS_WEEK_BIAS_WEIGHT;
}

function maxPriorGtDays(priorGtDays) {
  const values = Object.values(priorGtDays || {});
  return values.length ? Math.max(...values) : 0;
}

function buildWeekDates(weekStart) {
  const start = parseLocalDate(weekStart);
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.push({ date: dateStr, dayName: WEEKDAYS[d.getDay()] });
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
    for (let d = new Date(start); d <= finish; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (weekDateSet.has(dateStr)) leaveDatesByChef[entry.chef].add(dateStr);
    }
  });
  return leaveDatesByChef;
}

function getAnnualLeaveHoursByChef(state, weekDateSet) {
  const leaveDatesByChef = getAnnualLeaveDatesByChef(state, weekDateSet);
  const result = Object.fromEntries(state.staff.map((staff) => [staff.name, 0]));
  Object.entries(leaveDatesByChef).forEach(([chef, dateSet]) => {
    const creditedDays = Math.min(dateSet.size, 4);
    result[chef] = creditedDays * 12;
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
    .sort((a, b) => b.priority - a.priority)
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

function pickBestForSection({ section, dayName, candidates, selectedNames, ruleOverrides, gtDaysByChef, mioChefName, priorGtDays }) {
  const maxPrior = maxPriorGtDays(priorGtDays);

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
      const crossWeekBiasA = getCrossWeekBias(a.name, priorGtDays, maxPrior);
      const crossWeekBiasB = getCrossWeekBias(b.name, priorGtDays, maxPrior);

      const scoreA = (getSectionScore(a, section, ruleOverrides) * 10)
        + getRoleBonus(a, dayName)
        + urgencyA
        + mioWeekendBoostA
        + passSeniorA
        + passPrefA
        + crossWeekBiasA
        - getSoftRulePenalty(a.name, dayName)
        - (gtDaysByChef[a.name] || 0);

      const scoreB = (getSectionScore(b, section, ruleOverrides) * 10)
        + getRoleBonus(b, dayName)
        + urgencyB
        + mioWeekendBoostB
        + passSeniorB
        + passPrefB
        + crossWeekBiasB
        - getSoftRulePenalty(b.name, dayName)
        - (gtDaysByChef[b.name] || 0);

      return scoreB - scoreA;
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
    .sort((a, b) => getRoleBonus(b, dayName) - getRoleBonus(a, dayName))[0];

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
  priorGtDays
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
      .slice()
      .sort((a, b) => getSectionScore(forced, b, ruleOverrides) - getSectionScore(forced, a, ruleOverrides))[0];
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
      priorGtDays
    });
    if (!best) return;
    assignments.push({ chef: best.name, section });
    selectedNames.add(best.name);
  });

  if (assignments.length !== coreSections.length) return null;

  ensureSeniorCoverage({ assignments, dayName, candidates, selectedNames, ruleOverrides });

  while (selectedNames.size < requiredChefs) {
    const maxPrior = maxPriorGtDays(priorGtDays);
    const extra = candidates
      .filter((staff) => !selectedNames.has(staff.name))
      .sort((a, b) => {
        const urgencyA = Math.max(getGtTargetForChef(a.name, mioChefName) - (gtDaysByChef[a.name] || 0), 0);
        const urgencyB = Math.max(getGtTargetForChef(b.name, mioChefName) - (gtDaysByChef[b.name] || 0), 0);
        const seniorA = isSenior(a) ? 1 : 0;
        const seniorB = isSenior(b) ? 1 : 0;
        const crossWeekBiasA = getCrossWeekBias(a.name, priorGtDays, maxPrior);
        const crossWeekBiasB = getCrossWeekBias(b.name, priorGtDays, maxPrior);
        if (seniorB !== seniorA) return seniorB - seniorA;
        if (urgencyB !== urgencyA) return urgencyB - urgencyA;
        const biasA = crossWeekBiasA + getRoleBonus(a, dayName);
        const biasB = crossWeekBiasB + getRoleBonus(b, dayName);
        return biasB - biasA;
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

export function buildRota(inputs, options = {}) {
  const priorGtDays = options.priorGtDays || {};
  const state = getState();
  const dates = buildWeekDates(inputs.weekStart);
  const weekDateSet = new Set(dates.map((item) => item.date));
  const ruleOverrides = { _availability: state.weeklyInputs.availability };
  const annualLeaveHoursByChef = getAnnualLeaveHoursByChef(state, weekDateSet);

  const mioChefName = inputs.mioChef;
  const mioChef = state.staff.find((staff) => staff.name === mioChefName);
  const mioDays = getMioDayPlan(state, dates, mioChefName, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible) {
    if (mioDays.size !== 3) {
      return {
        status: 'infeasible',
        rota: [],
        validation: [{ day: 'Overall', message: `${mioChefName}: cannot place exactly 3 MIO shifts due to availability/unavailability constraints.`, severity: 'bad' }],
        summary: []
      };
    }
  }

  const mioGtDayPlanOptions = getMioGtDayPlanOptions(state, dates, mioChefName, mioDays, ruleOverrides);
  if (mioChefName && mioChef?.mioEligible && !mioGtDayPlanOptions.length) {
    return {
      status: 'infeasible',
      rota: [],
      validation: [{ day: 'Overall', message: `${mioChefName}: cannot place exactly 2 GT shifts on non-MIO days due to availability/unavailability constraints.`, severity: 'bad' }],
      summary: []
    };
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

    dates.forEach(({ dayName, date }) => {
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
        priorGtDays
      });

      if (!dayPlan) {
        validation.push({ day: dayName, message: 'Could not build a valid day plan with current hard constraints.', severity: 'bad' });
        return;
      }

      const breakfastAssignment = dayPlan.assignments.find((assignment) => assignment.section === 'Breakfast');
      if (breakfastAssignment) {
        breakfastCounts[breakfastAssignment.chef] = (breakfastCounts[breakfastAssignment.chef] || 0) + 1;
      }

      dayPlan.chefs.forEach((chefName) => {
        gtDaysByChef[chefName] += 1;
        gtHoursByChef[chefName] += getHoursForDay(dayName);
      });

      if (mioChef && mioChef.mioEligible && mioDays.has(dayName) && !isUnavailable(mioChef, date, dayName, ruleOverrides)) {
        dayPlan.assignments.push({ chef: mioChefName, section: 'MIO' });
        mioDaysByChef[mioChefName] += 1;
        mioHoursByChef[mioChefName] += getHoursForAssignment(dayName, 'MIO');
      }

      rota.push(dayPlan);
    });

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
    const isFeasible = rota.length > 0 && !validation.some((item) => item.severity === 'bad') && hardFailures.length === 0;

    if (isFeasible) {
      return {
        status: 'ok',
        rota,
        validation,
        summary
      };
    }

    if (i === attemptPlans.length - 1) {
      return {
        status: 'infeasible',
        rota,
        validation: validation.concat(hardFailures.map((result) => ({ day: 'Overall', message: `${result.ruleId}: ${result.message}`, severity: 'bad' }))),
        summary
      };
    }
  }

  return {
    status: 'infeasible',
    rota: [],
    validation: [{ day: 'Overall', message: 'Could not build a valid week plan with current hard constraints.', severity: 'bad' }],
    summary: []
  };
}

function advanceWeekStart(weekStart, days) {
  const parts = weekStart.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function buildMultiWeekRota(inputs, numWeeks) {
  const weeks = Math.max(1, Math.min(8, Number(numWeeks) || 1));
  const cumulativeGtDays = {};
  const results = [];

  for (let i = 0; i < weeks; i += 1) {
    const weekStart = advanceWeekStart(inputs.weekStart, i * 7);
    const weekInputs = { ...inputs, weekStart };
    const result = buildRota(weekInputs, { priorGtDays: { ...cumulativeGtDays } });
    results.push({ weekIndex: i, weekStart, ...result });

    if (result.summary) {
      result.summary.forEach((item) => {
        cumulativeGtDays[item.name] = (cumulativeGtDays[item.name] || 0) + (item.gtDays || 0);
      });
    }
  }

  return results;
}
