import { WEEKDAYS } from './constants.js';
import { parseLocalDate, toDateString, normalizeWeekStart, getWeekStartAtOffset } from './utils.js';
import { canCoverSection, getSectionLevel } from './section-levels.js';
import { getCoreSections, getRequiredChefCount, getAdjustedGtTargetsByChef, isUnavailable } from './validation.js?v=20260719u';
import { isSenior } from './scoring.js?v=20260719u';
import { getGtChefNamesForDay, hasGtAssignment } from './rota-model.js?v=20260719u';

export const DIAGNOSTIC_CODES = Object.freeze({
  PREFERRED_DAY_OFF_SATISFIED: 'preferred-day-off-satisfied',
  PREFERRED_DAY_OFF_MISSED: 'preferred-day-off-missed',
  PREFERRED_BREAKFAST_SATISFIED: 'preferred-breakfast-satisfied',
  PREFERRED_BREAKFAST_MISSED: 'preferred-breakfast-missed',
  CONSECUTIVE_WEEKEND_OFF: 'consecutive-weekend-off-awarded',
  WEEKEND_FAIRNESS_COMPROMISE: 'weekend-fairness-compromise',
  SECTION_COMPROMISE: 'section-strength-compromise',
  WEEKLY_TARGET_MISSED: 'weekly-target-missed',
  SENIOR_COVER_REQUIRED: 'senior-cover-required',
  INSUFFICIENT_ALTERNATIVES: 'insufficient-eligible-alternatives',
  AVAILABILITY_REDUCED_OPTIONS: 'availability-reduced-options',
  MIO_AFFECTED_ALLOCATION: 'mio-requirement-affecting-allocation',
  ADDITIONAL_STAFFING: 'additional-staffing-requirement',
  UNCOVERED_OR_INVALID: 'uncovered-or-invalid-assignment'
});

const TYPE_ORDER = { warning: 0, compromise: 1, fairness: 2, satisfied: 3 };

function chefId(state, name) {
  return state.staff.find((chef) => chef.name === name)?.id || name;
}

function diagnostic(code, type, importance, message, extra = {}) {
  return { code, type, importance, message, affectsScore: false, ...extra };
}

export function rankDiagnostics(items = []) {
  return items.slice().sort((a, b) => (
    (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    || (b.importance || 0) - (a.importance || 0)
    || String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.message || '').localeCompare(String(b.message || ''))
  ));
}

export function summarizeDiagnostics(items = [], limit = 5) {
  const ranked = rankDiagnostics(items);
  const seen = new Set();
  const unique = ranked.filter((item) => {
    const key = `${item.code}|${item.chefId || ''}|${item.date || ''}|${item.section || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { visible: unique.slice(0, limit), remaining: unique.slice(limit), all: unique };
}

function dayAssignment(day, section) {
  return (day.assignments || []).find((assignment) => assignment.section === section);
}

function unavailableNames(state, inputs, date, dayName) {
  const ruleOverrides = { _availability: inputs.availability || [] };
  return state.staff.filter((chef) => isUnavailable(chef, date, dayName, ruleOverrides)).map((chef) => chef.name);
}

function strongestMissedDayOffEvidence({ state, inputs, rota, day, chef }) {
  const otherAvailableSeniors = state.staff.filter((candidate) => candidate.name !== chef.name
    && isSenior(candidate)
    && !isUnavailable(candidate, day.date, day.dayName, { _availability: inputs.availability || [] }));
  const seniorRequired = isSenior(chef) && !otherAvailableSeniors.length;
  if (seniorRequired) return {
    code: DIAGNOSTIC_CODES.SENIOR_COVER_REQUIRED,
    reason: 'senior cover was required',
    supportingReasonCodes: ['H008']
  };

  const requiredSections = getCoreSections(day.dayName);
  const uniquelyCovered = requiredSections.find((section) => {
    const assigned = dayAssignment(day, section);
    if (assigned?.chef !== chef.name) return false;
    return !state.staff.some((candidate) => candidate.name !== chef.name
      && !isUnavailable(candidate, day.date, day.dayName, { _availability: inputs.availability || [] })
      && canCoverSection(candidate, section));
  });
  if (uniquelyCovered) return {
    code: DIAGNOSTIC_CODES.INSUFFICIENT_ALTERNATIVES,
    reason: `${uniquelyCovered} had no other eligible available chef`,
    section: uniquelyCovered,
    supportingReasonCodes: ['H025']
  };
  return null;
}

export function buildRotaDiagnostics({ state, week, hardValidation = [], softScore = null }) {
  const rota = week.rota || [];
  const inputs = week.inputs || {};
  const items = [];
  hardValidation.filter((result) => !result.passed).forEach((result) => {
    items.push(diagnostic(DIAGNOSTIC_CODES.UNCOVERED_OR_INVALID, 'warning', 100, result.message, {
      ruleId: result.ruleId,
      supportingReasonCodes: [result.ruleId]
    }));
  });

  state.staff.forEach((chef) => {
    (chef.preferredDaysOff || []).forEach((dayName) => {
      const day = rota.find((entry) => entry.dayName === dayName);
      if (!day) return;
      const worked = hasGtAssignment(day, chef.name);
      if (!worked) {
        if (!isUnavailable(chef, day.date, dayName, { _availability: inputs.availability || [] })) {
          items.push(diagnostic(DIAGNOSTIC_CODES.PREFERRED_DAY_OFF_SATISFIED, 'satisfied', 35,
            `${chef.name} received their preferred ${dayName} off.`, {
              chefId: chef.id, date: day.date, weekStart: week.weekStart, preference: 'preferred-day-off'
            }));
        }
        return;
      }
      const evidence = strongestMissedDayOffEvidence({ state, inputs, rota, day, chef });
      const reason = evidence ? ` because ${evidence.reason}` : ' while meeting higher-priority coverage requirements';
      items.push(diagnostic(DIAGNOSTIC_CODES.PREFERRED_DAY_OFF_MISSED, 'compromise', 90,
        `${chef.name}'s preferred ${dayName} off could not be satisfied${reason}.`, {
          chefId: chef.id, date: day.date, weekStart: week.weekStart, preference: 'preferred-day-off',
          affectsScore: true, scoreRuleId: 'S002', evidenceCode: evidence?.code || null,
          section: evidence?.section, supportingReasonCodes: evidence?.supportingReasonCodes || ['S002']
        }));
    });

    if (chef.preferredBreakfast) {
      const preferredDay = rota.find((day) => day.dayName === chef.preferredBreakfast);
      if (preferredDay && !isUnavailable(chef, preferredDay.date, preferredDay.dayName, { _availability: inputs.availability || [] })) {
        const assignment = dayAssignment(preferredDay, 'Breakfast');
        const satisfied = assignment?.chef === chef.name;
        items.push(diagnostic(
          satisfied ? DIAGNOSTIC_CODES.PREFERRED_BREAKFAST_SATISFIED : DIAGNOSTIC_CODES.PREFERRED_BREAKFAST_MISSED,
          satisfied ? 'satisfied' : 'compromise', satisfied ? 30 : 55,
          satisfied
            ? `${chef.name} received their preferred ${chef.preferredBreakfast} breakfast.`
            : `${chef.name}'s preferred ${chef.preferredBreakfast} breakfast could not be satisfied while meeting coverage requirements.`,
          { chefId: chef.id, date: preferredDay.date, weekStart: week.weekStart, preference: 'preferred-breakfast', affectsScore: true, scoreRuleId: 'preferred-breakfast' }
        ));
      }
    }

    const worked = new Set(rota.filter((day) => hasGtAssignment(day, chef.name)).map((day) => day.dayName));
    if (!worked.has('Saturday') && !worked.has('Sunday')) {
      const weekendDates = rota.filter((day) => ['Saturday', 'Sunday'].includes(day.dayName));
      const genuinelyFree = weekendDates.length === 2 && weekendDates.every((day) => !isUnavailable(chef, day.date, day.dayName, { _availability: inputs.availability || [] }));
      if (genuinelyFree) items.push(diagnostic(DIAGNOSTIC_CODES.CONSECUTIVE_WEEKEND_OFF, 'fairness', 45,
        `${chef.name} received Saturday and Sunday off together.`, { chefId: chef.id, weekStart: week.weekStart }));
    }
  });

  rota.forEach((day) => {
    (day.assignments || []).forEach((assignment) => {
      if (['Breakfast', 'MIO', 'Float'].includes(assignment.section)) return;
      const chef = state.staff.find((candidate) => candidate.name === assignment.chef);
      const level = chef ? getSectionLevel(chef, assignment.section) : 0;
      if (level !== 1) return;
      const stronger = state.staff.filter((candidate) => candidate.name !== chef.name
        && !isUnavailable(candidate, day.date, day.dayName, { _availability: inputs.availability || [] })
        && getSectionLevel(candidate, assignment.section) > level);
      items.push(diagnostic(DIAGNOSTIC_CODES.SECTION_COMPROMISE, 'compromise', 60,
        stronger.length
          ? `${chef.name} covered ${assignment.section} at training level while stronger options were needed elsewhere.`
          : `${chef.name} covered ${assignment.section} at training level because no stronger available option was identified.`, {
            chefId: chef.id, date: day.date, weekStart: week.weekStart, section: assignment.section,
            affectsScore: true, scoreRuleId: 'section-quality', supportingReasonCodes: ['H025']
          }));
    });
  });

  if (softScore?.weekendFairnessPenalty > 0) items.push(diagnostic(
    DIAGNOSTIC_CODES.WEEKEND_FAIRNESS_COMPROMISE, 'fairness', 50,
    'Weekend duties could not be distributed completely evenly across this rota.',
    { weekStart: week.weekStart, affectsScore: true, scoreRuleId: 'S004' }
  ));
  return rankDiagnostics(items);
}

function buildDates(weekStart) {
  const start = parseLocalDate(normalizeWeekStart(weekStart));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: toDateString(date), dayName: WEEKDAYS[date.getDay()] };
  });
}

function maximumMatching(sections, candidatesBySection) {
  const assignedChef = new Map();
  function assign(section, visited) {
    for (const chefName of candidatesBySection[section] || []) {
      if (visited.has(chefName)) continue;
      visited.add(chefName);
      const previous = assignedChef.get(chefName);
      if (!previous || assign(previous, visited)) {
        assignedChef.set(chefName, section);
        return true;
      }
    }
    return false;
  }
  return sections.reduce((count, section) => count + (assign(section, new Set()) ? 1 : 0), 0);
}

function readinessIssue(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

export function checkWeekFeasibility({ state, inputs, weekStart, weekIndex = 0 }) {
  const weekInputs = { ...inputs, weekStart };
  const dates = buildDates(weekStart);
  const ruleOverrides = { _availability: inputs.availability || [] };
  const issues = [];
  const selectedMio = inputs.mioChef ? state.staff.find((chef) => chef.name === inputs.mioChef) : null;
  if (inputs.mioChef && (!selectedMio || !selectedMio.mioEligible)) {
    issues.push(readinessIssue('invalid-mio-chef', 'error', `${inputs.mioChef} is not eligible for MIO duty.`, { weekStart, weekIndex }));
  }

  dates.forEach(({ date, dayName }) => {
    const available = state.staff.filter((chef) => !isUnavailable(chef, date, dayName, ruleOverrides));
    // The MIO chef's three weekday duties are chosen by the solver, so they remain a
    // possible GT chef on any individual day during this conservative preflight.
    const gtAvailable = available;
    const requiredCount = getRequiredChefCount(dayName, weekInputs, date);
    const sections = getCoreSections(dayName);
    const prefix = `${dayName} ${parseLocalDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    if (gtAvailable.length < requiredCount) {
      issues.push(readinessIssue('insufficient-chefs', 'error', `${prefix}: ${requiredCount} chefs are required but only ${gtAvailable.length} are available.`, { date, dayName, weekStart, weekIndex }));
    } else if (gtAvailable.length === requiredCount) {
      issues.push(readinessIssue('minimum-chefs', 'warning', `${prefix}: exactly the minimum ${requiredCount} chefs are available, so there is no staffing flexibility.`, { date, dayName, weekStart, weekIndex }));
    }
    const seniors = gtAvailable.filter(isSenior);
    if (!seniors.length) issues.push(readinessIssue('no-senior', 'error', `${prefix}: no senior chef is available.`, { date, dayName, weekStart, weekIndex }));
    else if (seniors.length === 1) issues.push(readinessIssue('single-senior', 'warning', `${prefix}: only ${seniors[0].name} can provide senior cover.`, { date, dayName, weekStart, weekIndex, chefId: seniors[0].id }));
    const breakfast = gtAvailable.filter((chef) => chef.breakfastEligible);
    if (!breakfast.length) issues.push(readinessIssue('no-breakfast', 'error', `${prefix}: no breakfast-eligible chef is available.`, { date, dayName, weekStart, weekIndex }));

    const candidatesBySection = Object.fromEntries(sections.map((section) => [section, gtAvailable.filter((chef) => canCoverSection(chef, section)).map((chef) => chef.name)]));
    sections.forEach((section) => {
      const candidates = candidatesBySection[section];
      if (!candidates.length) issues.push(readinessIssue('uncovered-section', 'error', `${prefix}: nobody available can cover ${section}.`, { date, dayName, weekStart, weekIndex, section }));
      else if (candidates.length === 1) issues.push(readinessIssue('single-section-option', 'warning', `${prefix}: only ${candidates[0]} can cover ${section}.`, { date, dayName, weekStart, weekIndex, section, chefId: chefId(state, candidates[0]) }));
    });
    if (maximumMatching(sections, candidatesBySection) < sections.length) {
      issues.push(readinessIssue('simultaneous-section-impossible', 'error', `${prefix}: the available chefs cannot cover all required sections at the same time.`, { date, dayName, weekStart, weekIndex }));
    }
  });

  if (selectedMio?.mioEligible) {
    const availableDays = dates.filter((day) => !isUnavailable(selectedMio, day.date, day.dayName, ruleOverrides));
    const weekdayDays = availableDays.filter((day) => !['Saturday', 'Sunday'].includes(day.dayName));
    if (availableDays.length < 5 || weekdayDays.length < 3) issues.push(readinessIssue('mio-pattern-impossible', 'error', `${selectedMio.name} cannot complete the required three MIO shifts and two GT shifts in this week.`, { weekStart, weekIndex, chefId: selectedMio.id }));
  }

  const targets = getAdjustedGtTargetsByChef({ staff: state.staff, mioChefName: inputs.mioChef, availability: inputs.availability || [], weeklyDates: dates.map((day) => day.date) });
  const requiredSlots = dates.reduce((total, day) => total + getRequiredChefCount(day.dayName, weekInputs, day.date), 0);
  const targetSlots = Object.values(targets).reduce((total, value) => total + value, 0);
  if (targetSlots < requiredSlots) issues.push(readinessIssue('weekly-target-capacity', 'error', `Weekly GT targets provide ${targetSlots} shifts, but ${requiredSlots} shifts are required.`, { weekStart, weekIndex }));
  return issues;
}

export function checkRotaFeasibility({ state, inputs }) {
  const count = Math.max(1, Math.min(8, Number.parseInt(inputs.numWeeks, 10) || 1));
  const issues = [];
  for (let index = 0; index < count; index += 1) {
    const weekStart = getWeekStartAtOffset(inputs.weekStart, index);
    const mioChef = inputs.weeklyMioSelections?.[weekStart] ?? (index === 0 ? inputs.mioChef : '');
    issues.push(...checkWeekFeasibility({ state, inputs: { ...inputs, mioChef }, weekStart, weekIndex: index }));
  }
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { status: errors.length ? 'blocked' : (warnings.length ? 'warnings' : 'ready'), issues, errors, warnings, checkedAt: Date.now() };
}
