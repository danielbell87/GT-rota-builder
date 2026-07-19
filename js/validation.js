import { CORE_SECTIONS, SHIFT_LENGTHS } from './constants.js';
import { normalizeWeekStart, parseLocalDate, toDateString } from './utils.js';
import { isSenior } from './scoring.js';
import { canCoverSection } from './section-levels.js';
import { getGtChefNamesForDay, getGtDaysByChef, getVisibleGtChefDayTotal, hasGtAssignment } from './rota-model.js';

// Weekly leave credit is capped at four days because a standard GT week targets four credited workdays.
const MAX_CREDITABLE_LEAVE_DAYS = 4;
export const PRIMARY_GT_SECTIONS = [...CORE_SECTIONS, 'Float'];

export function isUnavailable(staff, date, dayName, ruleOverrides) {
  const availability = ruleOverrides._availability || [];
  const leave = availability.some((entry) => {
    if (entry.chef !== staff.name) return false;
    if (entry.type !== 'Annual Leave' && entry.type !== 'Unavailable') return false;
    const start = entry.startDate || entry.date;
    const finish = entry.type === 'Annual Leave' ? (entry.finishDate || entry.date) : (entry.startDate || entry.date);
    const current = parseLocalDate(date);
    const startDate = parseLocalDate(start);
    const finishDate = parseLocalDate(finish);
    return current >= startDate && current <= finishDate;
  });
  return leave;
}

export function getWeeklyContextAdjustments(inputs, dayName, date) {
  // Date-based additional chef requirements (primary)
  const additionalReqs = inputs.additionalChefRequirements || [];
  const req = date ? additionalReqs.find((r) => r.date === date) : null;
  // Legacy day-based fallback for any remaining dailyOverrides data
  const dayOverride = inputs.dailyOverrides?.[dayName];
  const extraChefs = req ? (req.count || 0) : (dayOverride?.extraChefs || 0);
  return {
    eventName: dayOverride?.eventName || '',
    extraChefs,
    extraSections: []
  };
}

export function getRequiredChefCount(dayName, inputs, date) {
  const baseCount = ['Monday', 'Tuesday', 'Wednesday'].includes(dayName) ? 4 : 5;
  const adjustment = getWeeklyContextAdjustments(inputs, dayName, date);
  const extraChefs = adjustment.extraChefs || 0;
  return baseCount + extraChefs;
}

export function getCoreSections(dayName) {
  return ['Monday', 'Tuesday', 'Wednesday'].includes(dayName)
    ? ['Sauce', 'Garnish', 'Larder', 'Pastry']
    : ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'];
}

export function getMioPlacement(dayName) {
  if (['Monday', 'Tuesday', 'Wednesday'].includes(dayName)) return 'MIO';
  if (dayName === 'Saturday') return 'Weekend';
  if (dayName === 'Sunday') return 'Weekend';
  return 'Off';
}

function createResult(ruleId, passed, message, details = {}) {
  return {
    ruleId,
    passed,
    severity: 'hard',
    message,
    ...details
  };
}

function addIssueContext(result, { rota, inputs, state }) {
  const message = String(result.message || '');
  const day = result.date
    ? (rota || []).find((item) => item.date === result.date)
    : (rota || []).find((item) => message.startsWith(`${item.dayName}:`) || message.startsWith(`${item.dayName} ${item.date}:`));
  const chef = result.chefName
    ? (state.staff || []).find((item) => item.name === result.chefName)
    : (state.staff || []).find((item) => message.includes(item.name));
  const inferredSection = [...CORE_SECTIONS, 'Float', 'Breakfast', 'MIO'].find((name) => message.includes(name));
  const section = result.section || inferredSection
    || (['H006', 'H007', 'H028'].includes(result.ruleId) ? 'Breakfast' : '');
  const scopeByRule = {
    H006: 'section', H007: 'cell', H008: 'day', H009: 'day', H010: 'day', H011: 'section', H012: 'section',
    H013: 'day', H019: 'cell', H020: 'day', H023: 'cell', H025: 'section', H026: 'cell', H027: 'cell',
    H028: 'cell', H030: 'cell', H031: 'cell'
  };
  const typeByRule = {
    H006: 'missing-breakfast-cover', H007: 'breakfast-without-gt-assignment', H008: 'missing-senior-cover',
    H009: 'incorrect-daily-staffing', H010: 'insufficient-daily-staffing', H011: 'missing-pass-cover',
    H012: 'unexpected-pass-cover', H015: 'mio-shift-target', H016: 'weekly-gt-target',
    H019: 'unavailable-chef-assigned', H020: 'excessive-annual-leave', H022: 'mio-gt-target',
    H023: 'mio-gt-overlap', H025: 'invalid-section-cover', H026: 'duplicate-primary-assignment',
    H028: 'breakfast-ineligible'
  };
  const scope = result.scope || scopeByRule[result.ruleId] || 'week';
  const targetMatch = result.ruleId === 'H016' ? message.match(/expected exactly (\d+) GT days \(actual (\d+)\)/) : null;
  const affectedCells = Array.isArray(result.affectedCells) ? result.affectedCells : [];
  if (!affectedCells.length && scope !== 'day' && scope !== 'week' && day) {
    if (section) affectedCells.push({ date: day.date, section, chefName: chef?.name || '' });
    else if (chef) {
      day.assignments.filter((assignment) => assignment.chef === chef.name).forEach((assignment) => {
        affectedCells.push({ date: day.date, section: assignment.section, chefName: chef.name });
      });
    }
  }
  if (!affectedCells.length && result.ruleId === 'H016' && chef && targetMatch && Number(targetMatch[2]) > Number(targetMatch[1])) {
    const excess = Number(targetMatch[2]) - Number(targetMatch[1]);
    (rota || []).flatMap((rotaDay) => rotaDay.assignments
      .filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section) && assignment.chef === chef.name)
      .map((assignment) => ({ date: rotaDay.date, section: assignment.section, chefName: chef.name })))
      .slice(-excess)
      .forEach((cell) => affectedCells.push(cell));
  }
  const suggestedActions = {
    H025: `Assign an eligible ${section || 'section'} chef or change availability.`,
    H019: 'Remove the assignment or change the chef availability entry.',
    H008: 'Assign an available chef marked as Senior chef.',
    H006: 'Assign one Breakfast-eligible chef who is also working a GT section.',
    H007: 'Give the Breakfast chef a core or Float assignment, or choose another Breakfast chef.',
    H028: 'Choose a chef marked Breakfast eligible.',
    H009: 'Add or remove a visible GT assignment to meet the required staffing count.',
    H010: 'Fill an available Float or required-section position.',
    H011: 'Assign an eligible chef to Pass.',
    H016: 'Add or remove a visible GT assignment to meet the chef’s weekly target.'
  };
  return {
    ...result,
    type: result.type || typeByRule[result.ruleId] || `hard-rule-${String(result.ruleId || 'unknown').toLowerCase()}`,
    scope,
    weekIndex: Number.isInteger(inputs?.weekIndex) ? inputs.weekIndex : 0,
    weekStart: inputs?.weekStart || '',
    date: day?.date || '',
    dayName: day?.dayName || '',
    section: section || '',
    chefId: chef?.id || null,
    chefName: chef?.name || '',
    affectedCells,
    suggestedAction: result.passed ? '' : (suggestedActions[result.ruleId] || 'Review the highlighted assignments and adjust staffing or availability.')
  };
}

function findAssignmentsBySection(day, section) {
  return day.assignments.filter((a) => a.section === section);
}

function getChef(staff, name) {
  return staff.find((s) => s.name === name);
}

function getGtTargetForChef(chefName, mioChefName) {
  return chefName === mioChefName ? 2 : 4;
}

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return toDateString(parseLocalDate(dateStr)) === dateStr;
}

function forEachDateInRange(start, finish, callback) {
  for (let cursor = new Date(start); cursor <= finish; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    callback(cursor);
  }
}

function buildFullWeekDates(weekStart) {
  const start = parseLocalDate(normalizeWeekStart(weekStart));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toDateString(date);
  });
}

function normalizeFullWeekDates(fullWeekDates) {
  if (!Array.isArray(fullWeekDates) || fullWeekDates.length !== 7) return null;
  if (!fullWeekDates.every(isValidDateString)) return null;
  const uniqueSortedDates = [...new Set(fullWeekDates)].sort();
  if (uniqueSortedDates.length !== 7) return null;
  const expectedDates = buildFullWeekDates(uniqueSortedDates[0]);
  return JSON.stringify(uniqueSortedDates) === JSON.stringify(expectedDates) ? expectedDates : null;
}

function getSafeLegacyWeekDates(rota) {
  return normalizeFullWeekDates((rota || []).map((day) => day.date));
}

function resolveRequestedWeekDates({ fullWeekDates, inputs, rota, results }) {
  const expectedFromInputs = inputs?.weekStart ? buildFullWeekDates(inputs.weekStart) : null;
  if (typeof fullWeekDates !== 'undefined') {
    const normalizedProvidedDates = normalizeFullWeekDates(fullWeekDates);
    if (normalizedProvidedDates) {
      if (expectedFromInputs && JSON.stringify(normalizedProvidedDates) !== JSON.stringify(expectedFromInputs)) {
        results.push(createResult('H024', false, `Validation horizon ${normalizedProvidedDates[0]}..${normalizedProvidedDates[6]} does not match requested week ${expectedFromInputs[0]}..${expectedFromInputs[6]}`));
        return expectedFromInputs;
      }
      return normalizedProvidedDates;
    }
    results.push(createResult('H024', false, 'Week-based validation requires seven unique Monday-to-Sunday fullWeekDates.'));
    return expectedFromInputs || null;
  }
  if (expectedFromInputs) return expectedFromInputs;
  const legacyWeekDates = getSafeLegacyWeekDates(rota);
  if (legacyWeekDates) return legacyWeekDates;
  results.push(createResult('H024', false, 'Week-based validation requires fullWeekDates or inputs.weekStart when rota is partial or empty.'));
  return null;
}

export function getAnnualLeaveDatesByChef(availability = [], weeklyDates = []) {
  const weekDateSet = weeklyDates instanceof Set ? weeklyDates : new Set(weeklyDates);
  const leaveDatesByChef = {};
  availability.forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    if (!leaveDatesByChef[entry.chef]) leaveDatesByChef[entry.chef] = new Set();
    forEachDateInRange(start, finish, (cursor) => {
      const dateStr = toDateString(cursor);
      if (weekDateSet.has(dateStr)) leaveDatesByChef[entry.chef].add(dateStr);
    });
  });
  return leaveDatesByChef;
}

export function getAdjustedGtTargetForChef({ chefName, mioChefName, availability = [], weeklyDates = [] }) {
  const baseTarget = getGtTargetForChef(chefName, mioChefName);
  if (chefName === mioChefName) return baseTarget;
  const leaveDatesByChef = getAnnualLeaveDatesByChef(availability, weeklyDates);
  const annualLeaveDays = Math.min(leaveDatesByChef[chefName]?.size || 0, MAX_CREDITABLE_LEAVE_DAYS);
  return Math.max(0, baseTarget - annualLeaveDays);
}

export function getAdjustedGtTargetsByChef({ staff = [], mioChefName, availability = [], weeklyDates = [] }) {
  return Object.fromEntries(staff.map((member) => [member.name, getAdjustedGtTargetForChef({
    chefName: member.name,
    mioChefName,
    availability,
    weeklyDates
  })]));
}

// fullWeekDates is the requested Monday-to-Sunday scheduling horizon.
// It must remain independent of how many rota days were successfully generated.
export function validateRotaHardRules({ rota, state, inputs, summary, fullWeekDates }) {
  const results = [];
  const leavesByDate = {};
  const availability = inputs?.availability || state.weeklyInputs.availability || [];
  const requestedWeekDates = resolveRequestedWeekDates({ fullWeekDates, inputs, rota, results });
  const requestedWeekDateSet = new Set(requestedWeekDates || []);
  const annualLeaveDatesByChef = getAnnualLeaveDatesByChef(availability, requestedWeekDateSet);
  const adjustedTargetsByChef = getAdjustedGtTargetsByChef({
    staff: state.staff,
    mioChefName: inputs.mioChef,
    availability,
    weeklyDates: requestedWeekDateSet
  });
  const selectedMioChef = inputs.mioChef ? getChef(state.staff, inputs.mioChef) : null;
  const mioSelectionValid = !inputs.mioChef || (!!selectedMioChef && selectedMioChef.mioEligible === true);
  const mioSelectionMessage = !inputs.mioChef
    ? 'MIO chef: None (no MIO duty requested)'
    : selectedMioChef?.mioEligible
      ? `MIO chef: ${inputs.mioChef} is eligible`
      : selectedMioChef
        ? `MIO chef: ${inputs.mioChef} is not eligible`
        : `MIO chef: ${inputs.mioChef} is not in the current staff list`;
  results.push(createResult('H032', mioSelectionValid, mioSelectionMessage));

  if (requestedWeekDates) {
    const rotaDates = rota.map((day) => day.date);
    const uniqueRotaDates = new Set(rotaDates);
    const completeRequestedWeek = requestedWeekDates.every((date) => uniqueRotaDates.has(date))
      && uniqueRotaDates.size === requestedWeekDates.length
      && rotaDates.length === requestedWeekDates.length;
    results.push(createResult('H029', completeRequestedWeek, 'Rota must contain exactly one plan for each requested Monday-to-Sunday date'));
  }

  availability.forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    forEachDateInRange(start, finish, (cursor) => {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      leavesByDate[key] = (leavesByDate[key] || 0) + 1;
    });
  });

  rota.forEach((day) => {
    const knownChefNames = new Set(state.staff.map((chef) => chef.name));
    const internalGtChefs = Array.isArray(day.chefs) ? day.chefs : [];
    const canonicalGtChefs = getGtChefNamesForDay(day);
    const uniqueInternalGtChefs = new Set(internalGtChefs);
    const canonicalGtChefSet = new Set(canonicalGtChefs);
    const extraInternalChefs = [...uniqueInternalGtChefs].filter((name) => !canonicalGtChefSet.has(name));
    const missingInternalChefs = canonicalGtChefs.filter((name) => !uniqueInternalGtChefs.has(name));
    const duplicateInternalChefs = [...new Set(internalGtChefs.filter((name, index) => internalGtChefs.indexOf(name) !== index))];
    const consistencyDetails = [
      extraInternalChefs.length ? `Extra internal chef${extraInternalChefs.length === 1 ? '' : 's'}: ${extraInternalChefs.join(', ')}` : '',
      missingInternalChefs.length ? `Missing internal chef${missingInternalChefs.length === 1 ? '' : 's'}: ${missingInternalChefs.join(', ')}` : '',
      duplicateInternalChefs.length ? `Duplicate internal chef${duplicateInternalChefs.length === 1 ? '' : 's'}: ${duplicateInternalChefs.join(', ')}` : ''
    ].filter(Boolean).join('. ');
    results.push(createResult(
      'H033',
      !extraInternalChefs.length && !missingInternalChefs.length && !duplicateInternalChefs.length,
      `${day.dayName} ${day.date}: internal GT staffing ${consistencyDetails ? `does not match visible section assignments. ${consistencyDetails}.` : 'matches visible section assignments'}`
    ));
    canonicalGtChefs.forEach((chefName) => {
      const chef = getChef(state.staff, chefName);
      results.push(createResult('H019', !!chef && !isUnavailable(chef, day.date, day.dayName, { _availability: availability }), `${day.dayName}: ${chefName} must be known and available`, { date: day.date, dayName: day.dayName, chefName, scope: 'cell' }));
    });
    day.assignments.forEach((assignment) => {
      results.push(createResult('H030', knownChefNames.has(assignment.chef), `${day.dayName}: ${assignment.chef} assignment must reference a known chef`));
    });

    const requiredCoreSections = getCoreSections(day.dayName, inputs);
    requiredCoreSections.forEach((section) => {
      const assignments = findAssignmentsBySection(day, section);
      const assignedChef = assignments.length === 1 ? getChef(state.staff, assignments[0].chef) : null;
      const validCoverage = assignments.length === 1
        && canonicalGtChefSet.has(assignments[0].chef)
        && canCoverSection(assignedChef, section);
      results.push(createResult('H025', validCoverage, `${day.dayName}: ${section} must have exactly one eligible GT chef`, { date: day.date, dayName: day.dayName, section, chefName: assignments[0]?.chef || '', scope: 'section' }));
    });

    const breakfast = findAssignmentsBySection(day, 'Breakfast');
    results.push(createResult('H006', breakfast.length === 1, `${day.dayName}: expected exactly one breakfast chef`, { date: day.date, dayName: day.dayName, section: 'Breakfast', scope: 'section' }));

    if (breakfast.length === 1) {
      const breakfastChef = breakfast[0].chef;
      const breakfastStaff = getChef(state.staff, breakfastChef);
      const workingGtChefSet = new Set(day.assignments.filter((a) => PRIMARY_GT_SECTIONS.includes(a.section)).map((a) => a.chef));
      results.push(createResult('H007', workingGtChefSet.has(breakfastChef), `${day.dayName}: breakfast chef must also have a core or Float GT assignment`, { date: day.date, dayName: day.dayName, section: 'Breakfast', chefName: breakfastChef, scope: 'cell' }));
      results.push(createResult('H028', breakfastStaff?.breakfastEligible === true, `${day.dayName}: breakfast chef must be marked Breakfast eligible`, { date: day.date, dayName: day.dayName, section: 'Breakfast', chefName: breakfastChef, scope: 'cell' }));
    }

    const primaryAssignments = day.assignments.filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section));
    canonicalGtChefs.forEach((chefName) => {
      const primaryCount = primaryAssignments.filter((assignment) => assignment.chef === chefName).length;
      results.push(createResult('H026', primaryCount === 1, `${day.dayName}: ${chefName} must have exactly one primary GT assignment`, {
        date: day.date,
        dayName: day.dayName,
        chefName,
        scope: 'cell',
        affectedCells: primaryAssignments.filter((assignment) => assignment.chef === chefName).map((assignment) => ({ date: day.date, section: assignment.section, chefName }))
      }));
    });
    primaryAssignments.forEach((assignment) => {
      results.push(createResult('H027', canonicalGtChefSet.has(assignment.chef), `${day.dayName}: ${assignment.chef} has a primary GT assignment but is missing from canonical GT staffing`));
    });

    const hasSenior = canonicalGtChefs.some((name) => getChef(state.staff, name)?.senior === true);
    results.push(createResult('H008', hasSenior, `${day.dayName}: at least one chef marked Senior chef is required`, { date: day.date, dayName: day.dayName, scope: 'day' }));

    if (['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName)) {
      const requiredCount = getRequiredChefCount(day.dayName, inputs, day.date);
      results.push(createResult('H009', canonicalGtChefSet.size === requiredCount, `${day.dayName}: expected exactly ${requiredCount} visible GT chefs`, { date: day.date, dayName: day.dayName, scope: 'day' }));
      results.push(createResult('H012', findAssignmentsBySection(day, 'Pass').length === 0, `${day.dayName}: Pass should not be assigned`, { date: day.date, dayName: day.dayName, section: 'Pass', scope: 'section' }));
    }

    if (['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName)) {
      const requiredCount = getRequiredChefCount(day.dayName, inputs, day.date);
      results.push(createResult('H010', canonicalGtChefSet.size >= requiredCount, `${day.dayName}: expected at least ${requiredCount} visible GT chefs`, { date: day.date, dayName: day.dayName, scope: 'day' }));
      results.push(createResult('H011', findAssignmentsBySection(day, 'Pass').length >= 1, `${day.dayName}: Pass must be covered`, { date: day.date, dayName: day.dayName, section: 'Pass', scope: 'section' }));
    }

    const mioAssignments = findAssignmentsBySection(day, 'MIO');
    mioAssignments.forEach((assignment) => {
      const chef = getChef(state.staff, assignment.chef);
      results.push(createResult('H019', !!chef && !isUnavailable(chef, day.date, day.dayName, { _availability: availability }), `${day.dayName}: ${assignment.chef} must be available for MIO`, { date: day.date, dayName: day.dayName, section: 'MIO', chefName: assignment.chef, scope: 'cell' }));
      results.push(createResult('H023', !canonicalGtChefSet.has(assignment.chef), `${day.dayName}: ${assignment.chef} cannot overlap GT and MIO`, { date: day.date, dayName: day.dayName, section: 'MIO', chefName: assignment.chef, scope: 'cell' }));
      results.push(createResult('H031', assignment.chef === inputs.mioChef, `${day.dayName}: only the selected MIO chef may receive MIO`));
    });
    if (['Saturday', 'Sunday'].includes(day.dayName)) {
      results.push(createResult('H013', mioAssignments.length === 0, `${day.dayName}: MIO cannot be on weekends`));
    }
    mioAssignments.forEach((assignment) => {
      const chef = getChef(state.staff, assignment.chef);
      results.push(createResult('H014', !!chef?.mioEligible, `${day.dayName}: MIO chef must be eligible`));
    });

    if (leavesByDate[day.date] > 1) {
      results.push(createResult('H020', false, `${day.dayName}: more than one chef on annual leave`, { date: day.date, dayName: day.dayName, scope: 'day' }));
    }
  });

  const calculatedGtDays = getGtDaysByChef(rota);
  const gtDaysByChef = Object.fromEntries(state.staff.map((chef) => [chef.name, calculatedGtDays[chef.name] || 0]));
  Object.entries(gtDaysByChef).forEach(([name, count]) => {
    const adjustedGtTarget = adjustedTargetsByChef[name] ?? getGtTargetForChef(name, inputs.mioChef);
    results.push(createResult('H016', count === adjustedGtTarget, `${name}: expected exactly ${adjustedGtTarget} GT days (actual ${count})`, { chefName: name, scope: 'week' }));
  });

  const mioChef = inputs.mioChef;
  if (mioChef) {
    const mioDays = rota.filter((day) => day.assignments.some((a) => a.section === 'MIO' && a.chef === mioChef));
    const mioCount = mioDays.length;
    const hasWeekendMio = mioDays.some((day) => ['Saturday', 'Sunday'].includes(day.dayName));
    results.push(createResult('H015', mioCount === 3, `${mioChef}: expected exactly 3 MIO shifts (actual ${mioCount})`));
    results.push(createResult('H021', !hasWeekendMio, `${mioChef}: MIO cannot be assigned on Saturday or Sunday`));

    const mioGtDays = rota
      .filter((day) => hasGtAssignment(day, mioChef))
      .map((day) => day.dayName);
    results.push(createResult('H022', mioGtDays.length === 2, `${mioChef}: expected exactly 2 GT shifts (actual ${mioGtDays.length})`));

    const mioOverlap = rota.some((day) => {
      const hasMio = day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === mioChef);
      const hasGt = hasGtAssignment(day, mioChef);
      return hasMio && hasGt;
    });
    results.push(createResult('H023', !mioOverlap, `${mioChef}: cannot be assigned to both MIO and GT on the same day`));
  }

  const summaryByChef = Object.fromEntries((summary || []).map((item) => [item.name, item]));
  const visibleGtChefDayTotal = getVisibleGtChefDayTotal(rota);
  const summarizedGtChefDayTotal = Object.values(summaryByChef).reduce((total, item) => total + (item.gtDays || 0), 0);
  results.push(createResult(
    'H034',
    summarizedGtChefDayTotal === visibleGtChefDayTotal,
    `Visible GT chef-day total is ${visibleGtChefDayTotal}; summarized total is ${summarizedGtChefDayTotal}`
  ));
  state.staff.forEach((chef) => {
    const actualDays = gtDaysByChef[chef.name] || 0;
    const summaryDays = summaryByChef[chef.name]?.gtDays || 0;
    results.push(createResult('H035', summaryDays === actualDays, `${chef.name}: summary GT days ${summaryDays} must match visible assignments ${actualDays}`));
    const expectedGtHours = rota.reduce((total, day) => total + (
      hasGtAssignment(day, chef.name) ? (SHIFT_LENGTHS.regularByDay[day.dayName] || 0) : 0
    ), 0);
    const summaryGtHours = summaryByChef[chef.name]?.gtHours || 0;
    results.push(createResult('H036', summaryGtHours === expectedGtHours, `${chef.name}: summary GT hours ${summaryGtHours} must match visible-assignment hours ${expectedGtHours}`));
  });
  Object.entries(annualLeaveDatesByChef).forEach(([chef, dateSet]) => {
    const leaveDays = Math.min(dateSet.size, MAX_CREDITABLE_LEAVE_DAYS);
    const expectedCredit = leaveDays * SHIFT_LENGTHS.annualLeaveCreditPerDay;
    const actualCredit = summaryByChef[chef]?.annualLeaveHours || 0;
    results.push(createResult('H018', actualCredit === expectedCredit, `${chef}: annual leave credit ${actualCredit}h (expected ${expectedCredit}h)`));
  });

  Object.values(summaryByChef).forEach((item) => {
    const total = item.totalCreditedHours ?? item.hours ?? 0;
    results.push(createResult('H017', total >= 0, `${item.name}: target hour check evaluated (${Number(total).toFixed(1)}h)`));
  });

  return results.map((result) => addIssueContext(result, { rota, inputs, state }));
}

export function getStaffConfigurationWarnings(staff = []) {
  const requiredSections = [...CORE_SECTIONS, 'Breakfast'];
  const missingSections = requiredSections.filter((section) => {
    if (section === 'Breakfast') {
      return !staff.some((chef) => chef.breakfastEligible === true);
    }
    return !staff.some((chef) => canCoverSection(chef, section));
  });

  if (!missingSections.length) return [];
  return [{
    code: 'staff-section-coverage',
    message: `Staff configuration warning: no chef can currently cover ${missingSections.join(', ')}. Rota generation may be infeasible until coverage is restored.`
  }];
}

export function validateRotaSoftRules({ rota, state, inputs }) {
  const results = [];
  const ruleOverrides = {
    _availability: inputs?.availability || state?.weeklyInputs?.availability || []
  };

  rota.forEach((day) => {
    getGtChefNamesForDay(day).forEach((chefName) => {
      const chef = getChef(state.staff, chefName);
      if (!chef?.preferredDaysOff?.includes(day.dayName)) return;
      results.push({
        ruleId: 'S002',
        passed: false,
        severity: 'soft',
        message: `${day.dayName}: ${chefName} was scheduled despite a Preferred Day Off because satisfying hard constraints required the compromise.`
      });
    });
  });

  rota
    .filter((day) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .forEach((day) => {
      const passAssignments = findAssignmentsBySection(day, 'Pass');
      if (!passAssignments.length) {
        results.push({
          ruleId: 'prefer-senior-on-pass',
          passed: false,
          severity: 'soft',
          message: `${day.dayName}: Pass is missing so senior-on-Pass preference cannot be met`
        });
        return;
      }

      const passChef = getChef(state.staff, passAssignments[0].chef);
      const availableSeniors = state.staff.filter((chef) => isSenior(chef) && !isUnavailable(chef, day.date, day.dayName, ruleOverrides));

      if (isSenior(passChef)) {
        results.push({
          ruleId: 'prefer-senior-on-pass',
          passed: true,
          severity: 'soft',
          message: `${day.dayName}: senior chef ${passChef.name} assigned to Pass`
        });
        return;
      }

      if (!availableSeniors.length) {
        results.push({
          ruleId: 'prefer-senior-on-pass',
          passed: true,
          severity: 'soft',
          message: `${day.dayName}: non-senior on Pass accepted (no available senior chef)`
        });
        return;
      }

      results.push({
        ruleId: 'prefer-senior-on-pass',
        passed: false,
        severity: 'soft',
        message: `${day.dayName}: non-senior on Pass while available seniors were ${availableSeniors.map((chef) => chef.name).join(', ')}`
      });
    });

  return results;
}

export function isRotaValid(validationResults) {
  return validationResults.every((result) => result.passed);
}
