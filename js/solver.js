import { WEEKDAYS } from './constants.js';
import { getState } from './state.js';
import { parseLocalDate } from './utils.js';
import { getRuleOverrides } from './rules.js';
import {
  getSectionScore,
  getRoleBonus,
  getSoftRulePenalty,
  isSenior,
  getHoursForAssignment
} from './scoring.js';
import {
  isUnavailable,
  getRequiredChefCount,
  getCoreSections
} from './validation.js?v=20260714';

function getMioWeekdayPlan(state, inputs, dates, ruleOverrides) {
  if (!inputs.mioChef) return new Set();
  const mioStaff = state.staff.find((staff) => staff.name === inputs.mioChef);
  if (!mioStaff) return new Set();
  const targetDays = ['Monday', 'Tuesday', 'Wednesday'];
  const fallbackDays = ['Thursday', 'Friday'];
  const selected = [];

  targetDays.forEach((dayName) => {
    const date = dates.find((item) => item.dayName === dayName);
    if (!date) return;
    if (!isUnavailable(mioStaff, date.date, dayName, ruleOverrides)) {
      selected.push(dayName);
    }
  });

  let missing = targetDays.length - selected.length;
  if (missing > 0) {
    for (const dayName of fallbackDays) {
      if (missing <= 0) break;
      const date = dates.find((item) => item.dayName === dayName);
      if (!date) continue;
      if (isUnavailable(mioStaff, date.date, dayName, ruleOverrides)) continue;
      if (selected.includes(dayName)) continue;
      selected.push(dayName);
      missing -= 1;
    }
  }

  return new Set(selected);
}

function getMioCorePlan(state, inputs, dates, ruleOverrides, mioWeekdayPlan) {
  if (!inputs.mioChef) return new Set();
  const mioStaff = state.staff.find((staff) => staff.name === inputs.mioChef);
  if (!mioStaff) return new Set();

  const selected = [];
  const preferredOrder = ['Saturday', 'Sunday', 'Thursday', 'Friday'];
  const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const orderedDays = preferredOrder.concat(allDays.filter((day) => !preferredOrder.includes(day)));

  for (const dayName of orderedDays) {
    if (selected.length >= 2) break;
    if (mioWeekdayPlan.has(dayName)) continue;
    const date = dates.find((item) => item.dayName === dayName);
    if (!date) continue;
    if (isUnavailable(mioStaff, date.date, dayName, ruleOverrides)) continue;
    selected.push(dayName);
  }

  return new Set(selected);
}

function getPassPreferenceScore(staff, section, dayName, ruleOverrides) {
  if (section !== 'Pass') return 0;
  if (!['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(dayName)) return 0;
  const sectionStrength = getSectionScore(staff, 'Pass', ruleOverrides);
  const passPreferred = (staff.preferredSections || []).includes('Pass') ? 1 : 0;
  const seniorBonus = isSenior(staff) ? 120 : 0;
  return seniorBonus + (sectionStrength * 40) + (passPreferred * 12);
}

function createCoreDayPlan(available, dayName, requiredChefs, coreSections, ruleOverrides, shifts, targetShiftsByChef, remainingAvailableByChef) {
  if (available.length < coreSections.length) return null;
  const assignments = [];
  const selected = [];
  const remaining = available.slice();

  function getUrgencyScore(staff) {
    const target = targetShiftsByChef[staff.name] || 4;
    const worked = shifts[staff.name] || 0;
    const needed = Math.max(target - worked, 0);
    const remainingDays = Math.max(remainingAvailableByChef[staff.name] || 1, 1);
    return (needed / remainingDays) * 20 + (needed * 2);
  }

  for (const section of coreSections) {
    const sectionCandidates = remaining.filter((staff) => !selected.includes(staff.name)).sort((a, b) => {
      const seniorBonusA = isSenior(a) ? 1 : 0;
      const seniorBonusB = isSenior(b) ? 1 : 0;
      const aScore = (getSectionScore(a, section, ruleOverrides) * 10) + seniorBonusA + getRoleBonus(a, dayName) + getUrgencyScore(a) + getPassPreferenceScore(a, section, dayName, ruleOverrides) - getSoftRulePenalty(a.name, dayName) - (shifts[a.name] || 0);
      const bScore = (getSectionScore(b, section, ruleOverrides) * 10) + seniorBonusB + getRoleBonus(b, dayName) + getUrgencyScore(b) + getPassPreferenceScore(b, section, dayName, ruleOverrides) - getSoftRulePenalty(b.name, dayName) - (shifts[b.name] || 0);
      return bScore - aScore;
    });
    const best = sectionCandidates[0];
    if (!best) return null;
    assignments.push({ chef: best.name, section });
    selected.push(best.name);
    remaining.splice(remaining.indexOf(best), 1);
  }

  while (selected.length < requiredChefs) {
    const extraCandidates = remaining.filter((staff) => !selected.includes(staff.name)).sort((a, b) => {
      const seniorBonusA = isSenior(a) ? 1 : 0;
      const seniorBonusB = isSenior(b) ? 1 : 0;
      const aScore = seniorBonusA + getRoleBonus(a, dayName) + getUrgencyScore(a) - getSoftRulePenalty(a.name, dayName) - (shifts[a.name] || 0);
      const bScore = seniorBonusB + getRoleBonus(b, dayName) + getUrgencyScore(b) - getSoftRulePenalty(b.name, dayName) - (shifts[b.name] || 0);
      return bScore - aScore;
    });
    const extra = extraCandidates[0];
    if (!extra) return null;
    selected.push(extra.name);
    remaining.splice(remaining.indexOf(extra), 1);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const coreAssigned = assignments.map((item) => item.chef);
    const floatChefs = selected.filter((name) => !coreAssigned.includes(name));
    if (!floatChefs.length) break;
    let bestImprovement = null;

    floatChefs.forEach((floatName) => {
      const floatStaff = available.find((staff) => staff.name === floatName);
      if (!floatStaff) return;
      assignments.forEach((assignment, index) => {
        const incumbentStaff = available.find((staff) => staff.name === assignment.chef);
        if (!incumbentStaff) return;
        const floatScore = getSectionScore(floatStaff, assignment.section, ruleOverrides);
        const incumbentScore = getSectionScore(incumbentStaff, assignment.section, ruleOverrides);
        const floatPriority = getPassPreferenceScore(floatStaff, assignment.section, dayName, ruleOverrides);
        const incumbentPriority = getPassPreferenceScore(incumbentStaff, assignment.section, dayName, ruleOverrides);
        const improvement = (floatScore - incumbentScore) + ((floatPriority - incumbentPriority) / 100);
        if (improvement > 0 && (!bestImprovement || improvement > bestImprovement.improvement)) {
          bestImprovement = { index, floatName, improvement };
        }
      });
    });

    if (bestImprovement) {
      assignments[bestImprovement.index].chef = bestImprovement.floatName;
      changed = true;
    }
  }

  return { chefs: selected, assignments };
}

export function buildRota(inputs) {
  const state = getState();
  const start = parseLocalDate(inputs.weekStart);
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.push({ date: dateStr, dayName: WEEKDAYS[d.getDay()] });
  }

  const shifts = {};
  const breakfastCounts = {};
  const rota = [];
  const validation = [];
  const dayPlans = [];
  const ruleOverrides = { ...getRuleOverrides(inputs.changes), _availability: state.weeklyInputs.availability };
  const chefDayCounts = {};
  const mioChefName = inputs.mioChef;
  const mioStaff = state.staff.find((staff) => staff.name === mioChefName);
  const mioWeekdayPlan = getMioWeekdayPlan(state, inputs, dates, ruleOverrides);
  const mioCorePlan = getMioCorePlan(state, inputs, dates, ruleOverrides, mioWeekdayPlan);
  let mioCoreAssignedCount = 0;
  const targetShiftsByChef = Object.fromEntries(state.staff.map((staff) => [staff.name, staff.name === mioChefName ? 5 : 4]));

  for (let i = 0; i < dates.length; i += 1) {
    const current = dates[i];
    const dayName = current.dayName;
    const minimumChefs = getRequiredChefCount(dayName, inputs);
    const coreSections = getCoreSections(dayName, inputs);
    const remainingDates = dates.slice(i);

    const mioIsOnMioShiftToday = mioWeekdayPlan.has(dayName);

    const remainingAvailableByChef = Object.fromEntries(state.staff.map((staff) => {
      const count = remainingDates.filter((day) => {
        if (isUnavailable(staff, day.date, day.dayName, ruleOverrides)) return false;
        if (staff.name === mioChefName && mioWeekdayPlan.has(day.dayName)) return false;
        if (staff.name === mioChefName && !mioCorePlan.has(day.dayName)) return false;
        return true;
      }).length;
      return [staff.name, count];
    }));

    const available = state.staff.filter((staff) => {
      if (isUnavailable(staff, current.date, dayName, ruleOverrides)) return false;
      if (staff.name === mioChefName && mioIsOnMioShiftToday) return false;
      if (staff.name === mioChefName && !mioCorePlan.has(dayName)) return false;
      const maxShifts = targetShiftsByChef[staff.name] || 4;
      if ((shifts[staff.name] || 0) >= maxShifts) return false;
      return true;
    });

    const mustWorkToday = available.filter((staff) => {
      const target = targetShiftsByChef[staff.name] || 4;
      const worked = shifts[staff.name] || 0;
      const needed = Math.max(target - worked, 0);
      const remainingAvailable = Math.max(remainingAvailableByChef[staff.name] || 0, 0);
      return needed > 0 && needed >= remainingAvailable;
    });

    const requiredChefs = Math.max(minimumChefs, mustWorkToday.length);

    if (available.length < requiredChefs) {
      validation.push({ day: dayName, message: 'Not enough available chefs to satisfy minimum staffing', severity: 'bad' });
    }

    const dayPlan = createCoreDayPlan(available, dayName, requiredChefs, coreSections, ruleOverrides, shifts, targetShiftsByChef, remainingAvailableByChef);
    if (!dayPlan) {
      validation.push({ day: dayName, message: 'Could not build a valid day plan', severity: 'bad' });
      continue;
    }

    if (mioStaff && mioCorePlan.has(dayName) && !isUnavailable(mioStaff, current.date, dayName, ruleOverrides)) {
      const alreadyAssigned = dayPlan.assignments.some((assignment) => assignment.chef === mioChefName);
      if (!alreadyAssigned) {
        const replaceable = dayPlan.assignments
          .filter((assignment) => assignment.section !== 'Breakfast' && assignment.section !== 'MIO')
          .sort((a, b) => {
            const staffA = state.staff.find((staff) => staff.name === a.chef);
            const staffB = state.staff.find((staff) => staff.name === b.chef);
            const scoreA = getSectionScore(staffA, a.section, ruleOverrides);
            const scoreB = getSectionScore(staffB, b.section, ruleOverrides);
            return scoreA - scoreB;
          })[0];
        if (replaceable) {
          replaceable.chef = mioChefName;
          dayPlan.chefs = dayPlan.assignments.map((assignment) => assignment.chef);
        }
      }
      if (dayPlan.assignments.some((assignment) => assignment.chef === mioChefName && assignment.section !== 'Breakfast' && assignment.section !== 'MIO')) {
        mioCoreAssignedCount += 1;
      }
    }

    const coreAssignedNames = dayPlan.assignments.map((assignment) => assignment.chef);
    const breakfastCandidates = coreAssignedNames.map((name) => state.staff.find((staff) => staff.name === name)).filter((staff) =>
      staff &&
      staff.breakfastEligible &&
      (breakfastCounts[staff.name] || 0) === 0 &&
      staff.name !== mioChefName
    );
    if (!breakfastCandidates.length) {
      validation.push({ day: dayName, message: 'No eligible breakfast chef from core section assignments', severity: 'warn' });
    } else {
      const breakfastChef = breakfastCandidates.slice().sort((a, b) => {
        const aPref = a.preferredBreakfast === dayName ? 10 : 0;
        const bPref = b.preferredBreakfast === dayName ? 10 : 0;
        return (getSectionScore(b, 'Breakfast', ruleOverrides) + bPref - getSoftRulePenalty(b.name, dayName)) - (getSectionScore(a, 'Breakfast', ruleOverrides) + aPref - getSoftRulePenalty(a.name, dayName));
      })[0];
      dayPlan.assignments.push({ chef: breakfastChef.name, section: 'Breakfast' });
      breakfastCounts[breakfastChef.name] = (breakfastCounts[breakfastChef.name] || 0) + 1;
    }

    dayPlans.push({ dayName, date: current.date, assignments: dayPlan.assignments, chefs: dayPlan.chefs });

    const selectedChefs = dayPlans[dayPlans.length - 1].chefs;
    selectedChefs.forEach((name) => {
      shifts[name] = (shifts[name] || 0) + 1;
      chefDayCounts[name] = (chefDayCounts[name] || 0) + 1;
    });
    rota.push({ dayName, date: current.date, assignments: dayPlans[dayPlans.length - 1].assignments, chefs: selectedChefs });

    if (mioStaff && mioWeekdayPlan.has(dayName) && !isUnavailable(mioStaff, current.date, dayName, ruleOverrides)) {
      rota[rota.length - 1].assignments.push({ chef: mioChefName, section: 'MIO' });
      shifts[mioChefName] = (shifts[mioChefName] || 0) + 1;
      chefDayCounts[mioChefName] = (chefDayCounts[mioChefName] || 0) + 1;
    }

    const dayAssignments = rota[rota.length - 1];
    if (dayAssignments) {
      const hasSenior = dayAssignments.chefs.some((name) => {
        const staff = state.staff.find((s) => s.name === name);
        return isSenior(staff);
      });
      if (!hasSenior) {
        validation.push({ day: dayName, message: 'No Sous Chef or higher assigned (daily minimum required)', severity: 'warn' });
      }

      if (['Saturday', 'Sunday'].includes(dayName) && dayAssignments.chefs.includes('Aled')) {
        validation.push({ day: dayName, message: 'Soft rule broken: Aled prefers not to work weekends', severity: 'warn' });
      }
      if (dayName === 'Tuesday' && dayAssignments.chefs.includes('Charlie')) {
        validation.push({ day: dayName, message: 'Soft rule broken: Charlie prefers not to work Tuesdays', severity: 'warn' });
      }
    }
  }

  const couldNotBackfill = [];
  state.staff.forEach((staff) => {
    const name = staff.name;
    const unavailableForWeek = state.availability.some((entry) =>
      entry.chef === name && (entry.type === 'Annual Leave' || entry.type === 'Unavailable')
    );
    if (unavailableForWeek) return;

    const target = targetShiftsByChef[name] || 4;
    while ((shifts[name] || 0) < target) {
      const candidateDays = rota.filter((day) => {
        if (day.chefs.includes(name)) return false;
        if (isUnavailable(staff, day.date, day.dayName, ruleOverrides)) return false;
        if (name === mioChefName && mioWeekdayPlan.has(day.dayName)) return false;
        if (name === mioChefName && !mioCorePlan.has(day.dayName)) return false;
        return true;
      }).sort((a, b) => {
        const aSoftPenalty = getSoftRulePenalty(name, a.dayName);
        const bSoftPenalty = getSoftRulePenalty(name, b.dayName);
        if (aSoftPenalty !== bSoftPenalty) return aSoftPenalty - bSoftPenalty;
        return a.chefs.length - b.chefs.length;
      });

      const selectedDay = candidateDays[0];
      if (!selectedDay) {
        couldNotBackfill.push(name);
        break;
      }

      selectedDay.chefs.push(name);
      shifts[name] = (shifts[name] || 0) + 1;
      chefDayCounts[name] = (chefDayCounts[name] || 0) + 1;
    }
  });

  const issues = [];
  const breakfastCount = rota.filter((item) => item.assignments.some((a) => a.section === 'Breakfast')).length;
  if (breakfastCount < 7) issues.push('Some days are missing breakfast coverage');
  if (mioChefName && !rota.some((item) => item.assignments.some((assignment) => assignment.chef === mioChefName && assignment.section === 'MIO'))) {
    issues.push('MIO assignment was not created');
  }
  if (mioChefName && mioCorePlan.size > 0 && mioCoreAssignedCount < mioCorePlan.size) {
    issues.push(`${mioChefName} could not be placed on all planned GT core-section days`);
  }

  Object.entries(breakfastCounts).forEach(([chef, count]) => {
    if (count > 1) issues.push(`${chef} worked breakfast ${count} times (max 1 per week)`);
  });

  Object.entries(shifts).forEach(([chef, shiftCount]) => {
    const unavailable = state.availability.filter((entry) =>
      entry.chef === chef && (entry.type === 'Annual Leave' || entry.type === 'Unavailable')
    ).length > 0;
    const target = chef === mioChefName ? 5 : 4;
    if (shiftCount !== target && !unavailable) {
      if (shiftCount < target) issues.push(`${chef} only works ${shiftCount} days (should be ${target})`);
      if (shiftCount > target) issues.push(`${chef} works ${shiftCount} days (max ${target})`);
    }
  });

  if (couldNotBackfill.length) {
    const unique = [...new Set(couldNotBackfill)];
    issues.push(`Could not backfill float shifts to target days for: ${unique.join(', ')}`);
  }

  rota.slice(0, 3).forEach((day) => {
    const dayOverride = inputs.dailyOverrides?.[day.dayName];
    const expectedCount = ['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName) ? (4 + (dayOverride?.extraChefs || 0)) : 5;
    if (day.chefs.length > expectedCount) {
      issues.push(`${day.dayName}: ${day.chefs.length} chefs assigned (expected ${expectedCount})`);
    }
  });

  const summary = Object.entries(chefDayCounts).map(([name, count]) => ({ name, count, hours: 0 }));

  rota.forEach((day) => {
    const hoursByChef = {};
    day.assignments.forEach((assignment) => {
      const assignmentHours = getHoursForAssignment(day.dayName, assignment.section);
      hoursByChef[assignment.chef] = Math.max(hoursByChef[assignment.chef] || 0, assignmentHours);
    });
    Object.entries(hoursByChef).forEach(([chef, hours]) => {
      let entry = summary.find((item) => item.name === chef);
      if (!entry) {
        entry = { name: chef, count: 0, hours: 0 };
        summary.push(entry);
      }
      entry.hours += hours;
    });
  });

  if (!rota.length || validation.some((item) => item.severity === 'bad')) {
    return {
      status: 'infeasible',
      rota,
      validation: validation.concat(issues.map((message) => ({ day: 'Overall', message, severity: 'warn' }))),
      summary
    };
  }

  return {
    status: 'ok',
    rota,
    validation: validation.concat(issues.map((message) => ({ day: 'Overall', message, severity: 'warn' }))),
    summary
  };
}
