import { CORE_SECTIONS, ROLE_WEIGHT, SHIFT_LENGTHS } from './constants.js';
import { parseLocalDate } from './utils.js';
import { isSenior } from './scoring.js';
import { canCoverSection } from './section-levels.js';

export const PRIMARY_GT_SECTIONS = [...CORE_SECTIONS, 'Float'];

export function isUnavailable(staff, date, dayName, ruleOverrides) {
  const availability = ruleOverrides._availability || [];
  const weekendBlocked = staff.weekendRule === 'Does not work weekends' && ['Saturday', 'Sunday'].includes(dayName);
  const fixedOff = staff.fixedDayOff && staff.fixedDayOff.toLowerCase() === dayName.toLowerCase();
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
  return weekendBlocked || fixedOff || leave;
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

function createResult(ruleId, passed, message) {
  return {
    ruleId,
    passed,
    severity: 'hard',
    message
  };
}

function findAssignmentsBySection(day, section) {
  return day.assignments.filter((a) => a.section === section);
}

function getChef(staff, name) {
  return staff.find((s) => s.name === name);
}

function getBaseGtTargetForChef(chefName, mioChefName) {
  return chefName === mioChefName ? 2 : 4;
}

export function getAnnualLeaveDatesByChef(availability = [], weeklyDates = []) {
  const weeklyDateSet = weeklyDates instanceof Set ? weeklyDates : new Set(weeklyDates);
  const leaveDatesByChef = {};
  availability.forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    for (let current = new Date(start); current <= finish; current.setDate(current.getDate() + 1)) {
      const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      if (!weeklyDateSet.has(dateStr)) continue;
      if (!leaveDatesByChef[entry.chef]) leaveDatesByChef[entry.chef] = new Set();
      leaveDatesByChef[entry.chef].add(dateStr);
    }
  });
  return leaveDatesByChef;
}

export function getAdjustedGtTargetForChef({ chefName, mioChefName, availability = [], weeklyDates = [] }) {
  if (chefName === mioChefName) return getBaseGtTargetForChef(chefName, mioChefName);
  const leaveDatesByChef = getAnnualLeaveDatesByChef(availability, weeklyDates);
  const leaveDays = Math.min(leaveDatesByChef[chefName]?.size || 0, 4);
  return Math.max(0, 4 - leaveDays);
}

export function getAdjustedGtTargetsByChef({ staff = [], mioChefName, availability = [], weeklyDates = [] }) {
  return Object.fromEntries(staff.map((member) => [member.name, getAdjustedGtTargetForChef({
    chefName: member.name,
    mioChefName,
    availability,
    weeklyDates
  })]));
}

export function validateRotaHardRules({ rota, state, inputs, summary }) {
  const results = [];
  const leavesByDate = {};
  const weeklyDates = new Set(rota.map((day) => day.date));
  const availability = inputs?.availability || state.weeklyInputs.availability || [];
  const adjustedTargetsByChef = getAdjustedGtTargetsByChef({
    staff: state.staff,
    mioChefName: inputs.mioChef,
    availability,
    weeklyDates
  });

  availability.forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    for (let d = new Date(start); d <= finish; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      leavesByDate[key] = (leavesByDate[key] || 0) + 1;
    }
  });

  rota.forEach((day) => {
    const breakfast = findAssignmentsBySection(day, 'Breakfast');
    results.push(createResult('H006', breakfast.length === 1, `${day.dayName}: expected exactly one breakfast chef`));

    if (breakfast.length === 1) {
      const breakfastChef = breakfast[0].chef;
      const coreChefSet = new Set(day.assignments.filter((a) => CORE_SECTIONS.includes(a.section)).map((a) => a.chef));
      results.push(createResult('H007', coreChefSet.has(breakfastChef), `${day.dayName}: breakfast chef must also be on a core section`));
    }

    const primaryAssignments = day.assignments.filter((assignment) => PRIMARY_GT_SECTIONS.includes(assignment.section));
    day.chefs.forEach((chefName) => {
      const primaryCount = primaryAssignments.filter((assignment) => assignment.chef === chefName).length;
      results.push(createResult('H024', primaryCount === 1, `${day.dayName}: ${chefName} must have exactly one primary GT assignment`));
    });
    primaryAssignments.forEach((assignment) => {
      results.push(createResult('H025', day.chefs.includes(assignment.chef), `${day.dayName}: ${assignment.chef} has a primary GT assignment but is missing from day.chefs`));
    });

    const hasSenior = day.chefs.some((name) => {
      const chef = getChef(state.staff, name);
      return (ROLE_WEIGHT[chef?.role] || 0) >= ROLE_WEIGHT['Sous Chef'];
    });
    results.push(createResult('H008', hasSenior, `${day.dayName}: at least one Sous Chef or higher required`));

    if (['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName)) {
      const requiredCount = getRequiredChefCount(day.dayName, inputs, day.date);
      results.push(createResult('H009', new Set(day.chefs).size === requiredCount, `${day.dayName}: expected exactly ${requiredCount} GT chefs`));
      results.push(createResult('H012', findAssignmentsBySection(day, 'Pass').length === 0, `${day.dayName}: Pass should not be assigned`));
    }

    if (['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName)) {
      const requiredCount = getRequiredChefCount(day.dayName, inputs, day.date);
      results.push(createResult('H010', new Set(day.chefs).size >= requiredCount, `${day.dayName}: expected at least ${requiredCount} GT chefs`));
      results.push(createResult('H011', findAssignmentsBySection(day, 'Pass').length >= 1, `${day.dayName}: Pass must be covered`));
    }

    const mioAssignments = findAssignmentsBySection(day, 'MIO');
    if (['Saturday', 'Sunday'].includes(day.dayName)) {
      results.push(createResult('H013', mioAssignments.length === 0, `${day.dayName}: MIO cannot be on weekends`));
    }
    mioAssignments.forEach((assignment) => {
      const chef = getChef(state.staff, assignment.chef);
      results.push(createResult('H014', !!chef?.mioEligible, `${day.dayName}: MIO chef must be eligible`));
    });

    results.push(createResult('H001', !(['Saturday', 'Sunday'].includes(day.dayName) && day.chefs.includes('Aled')), `${day.dayName}: Aled must not work weekends`));
    results.push(createResult('H002', !(day.dayName === 'Tuesday' && day.chefs.includes('Charlie')), `${day.dayName}: Charlie must not work Tuesday`));

    day.assignments.forEach((assignment) => {
      if (assignment.chef === 'Myles' && assignment.section !== 'Larder' && assignment.section !== 'Float' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        results.push(createResult('H003', false, `${day.dayName}: Myles assigned outside Larder`));
      }
      if (assignment.chef === 'Fred' && assignment.section !== 'Garnish' && assignment.section !== 'Float' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        const chef = getChef(state.staff, 'Fred');
        const overridden = canCoverSection(chef, assignment.section);
        results.push(createResult('H004', overridden, `${day.dayName}: Fred assigned outside Garnish without skill override`));
      }
      if (assignment.chef === 'Joel' && assignment.section !== 'Sauce' && assignment.section !== 'Float' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        const chef = getChef(state.staff, 'Joel');
        const overridden = canCoverSection(chef, assignment.section);
        results.push(createResult('H005', overridden, `${day.dayName}: Joel assigned outside Sauce without skill override`));
      }
    });

    if (leavesByDate[day.date] > 1) {
      results.push(createResult('H020', false, `${day.dayName}: more than one chef on annual leave`));
    }
  });

  const gtDaysByChef = Object.fromEntries(state.staff.map((chef) => [chef.name, 0]));
  rota.forEach((day) => {
    day.chefs.forEach((chefName) => {
      gtDaysByChef[chefName] = (gtDaysByChef[chefName] || 0) + 1;
    });
  });
  Object.entries(gtDaysByChef).forEach(([name, count]) => {
    const gtTarget = adjustedTargetsByChef[name] ?? getBaseGtTargetForChef(name, inputs.mioChef);
    results.push(createResult('H016', count === gtTarget, `${name}: expected exactly ${gtTarget} GT days, actual ${count}.`));
  });

  const mioChef = inputs.mioChef;
  if (mioChef) {
    const mioDays = rota.filter((day) => day.assignments.some((a) => a.section === 'MIO' && a.chef === mioChef));
    const mioCount = mioDays.length;
    const hasWeekendMio = mioDays.some((day) => ['Saturday', 'Sunday'].includes(day.dayName));
    results.push(createResult('H015', mioCount === 3, `${mioChef}: expected exactly 3 MIO shifts (actual ${mioCount})`));
    results.push(createResult('H021', !hasWeekendMio, `${mioChef}: MIO cannot be assigned on Saturday or Sunday`));

    const mioGtDays = rota
      .filter((day) => day.chefs.includes(mioChef))
      .map((day) => day.dayName);
    results.push(createResult('H022', mioGtDays.length === 2, `${mioChef}: expected exactly 2 GT shifts (actual ${mioGtDays.length})`));

    const mioOverlap = rota.some((day) => {
      const hasMio = day.assignments.some((assignment) => assignment.section === 'MIO' && assignment.chef === mioChef);
      const hasGt = day.chefs.includes(mioChef);
      return hasMio && hasGt;
    });
    results.push(createResult('H023', !mioOverlap, `${mioChef}: cannot be assigned to both MIO and GT on the same day`));
  }

  const summaryByChef = Object.fromEntries((summary || []).map((item) => [item.name, item]));
  const leaveDatesByChef = getAnnualLeaveDatesByChef(availability, weeklyDates);

  Object.entries(leaveDatesByChef).forEach(([chef, dateSet]) => {
    const leaveDays = Math.min(dateSet.size, 4);
    const expectedCredit = leaveDays * SHIFT_LENGTHS.annualLeaveCreditPerDay;
    const actualCredit = summaryByChef[chef]?.annualLeaveHours || 0;
    results.push(createResult('H018', actualCredit === expectedCredit, `${chef}: annual leave credit ${actualCredit}h (expected ${expectedCredit}h)`));
  });

  Object.values(summaryByChef).forEach((item) => {
    const total = item.totalCreditedHours ?? item.hours ?? 0;
    results.push(createResult('H017', total >= 0, `${item.name}: target hour check evaluated (${Number(total).toFixed(1)}h)`));
  });

  return results;
}

export function getStaffConfigurationWarnings(staff = []) {
  const requiredSections = [...CORE_SECTIONS, 'Breakfast'];
  const missingSections = requiredSections.filter((section) => {
    if (section === 'Breakfast') {
      return !staff.some((chef) => chef.breakfastEligible !== false && canCoverSection(chef, 'Breakfast'));
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
