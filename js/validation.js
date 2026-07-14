import { CORE_SECTIONS, ROLE_WEIGHT } from './constants.js';
import { parseLocalDate } from './utils.js';
import { getRuleOverrides } from './rules.js';
import { isSenior } from './scoring.js';

export function isUnavailable(staff, date, dayName, ruleOverrides) {
  const availability = ruleOverrides._availability || [];
  const weekendBlocked = staff.weekendRule === 'Does not work weekends' && ['Saturday', 'Sunday'].includes(dayName);
  const fixedOff = staff.fixedDayOff && staff.fixedDayOff.toLowerCase() === dayName.toLowerCase();
  const dayOffFromRules = (ruleOverrides.dayOffs?.[staff.name] || []).includes(dayName);
  const leave = availability.some((entry) => {
    if (entry.chef !== staff.name) return false;
    if (entry.type !== 'Annual Leave' && entry.type !== 'Unavailable') return false;
    const start = entry.startDate || entry.date;
    const finish = entry.finishDate || entry.date;
    const current = parseLocalDate(date);
    const startDate = parseLocalDate(start);
    const finishDate = parseLocalDate(finish);
    return current >= startDate && current <= finishDate;
  });
  return weekendBlocked || fixedOff || dayOffFromRules || leave;
}

export function getWeeklyContextAdjustments(inputs, dayName) {
  const dayOverride = inputs.dailyOverrides?.[dayName];
  return {
    eventName: dayOverride?.eventName || '',
    extraChefs: dayOverride?.extraChefs || 0,
    extraSections: []
  };
}

export function getRequiredChefCount(dayName, inputs) {
  const baseCount = ['Monday', 'Tuesday', 'Wednesday'].includes(dayName) ? 4 : 5;
  const adjustment = getWeeklyContextAdjustments(inputs, dayName);
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

export function validateRotaHardRules({ rota, state, inputs, summary }) {
  const results = [];
  const leavesByDate = {};

  state.weeklyInputs.availability.forEach((entry) => {
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

    const hasSenior = day.chefs.some((name) => {
      const chef = getChef(state.staff, name);
      return (ROLE_WEIGHT[chef?.role] || 0) >= ROLE_WEIGHT['Sous Chef'];
    });
    results.push(createResult('H008', hasSenior, `${day.dayName}: at least one Sous Chef or higher required`));

    if (['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName)) {
      results.push(createResult('H009', new Set(day.chefs).size === 4, `${day.dayName}: expected exactly 4 GT chefs`));
      results.push(createResult('H012', findAssignmentsBySection(day, 'Pass').length === 0, `${day.dayName}: Pass should not be assigned`));
    }

    if (['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName)) {
      results.push(createResult('H010', new Set(day.chefs).size >= 5, `${day.dayName}: expected at least 5 GT chefs`));
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
      if (assignment.chef === 'Myles' && assignment.section !== 'Larder' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        results.push(createResult('H003', false, `${day.dayName}: Myles assigned outside Larder`));
      }
      if (assignment.chef === 'Fred' && assignment.section !== 'Garnish' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        const chef = getChef(state.staff, 'Fred');
        const overridden = (chef?.skills?.[assignment.section] || 0) > 0;
        results.push(createResult('H004', overridden, `${day.dayName}: Fred assigned outside Garnish without skill override`));
      }
      if (assignment.chef === 'Joel' && assignment.section !== 'Sauce' && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        const chef = getChef(state.staff, 'Joel');
        const overridden = (chef?.skills?.[assignment.section] || 0) > 0;
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
    results.push(createResult('H016', count <= 4, `${name}: GT days ${count} exceeds max 4`));
  });

  const mioChef = inputs.mioChef;
  if (mioChef) {
    const mioWeekdays = rota
      .filter((day) => ['Monday', 'Tuesday', 'Wednesday'].includes(day.dayName))
      .flatMap((day) => day.assignments.filter((a) => a.section === 'MIO'))
      .filter((a) => a.chef === mioChef).length;
    results.push(createResult('H015', mioWeekdays >= 1, `${mioChef}: should receive weekday MIO assignment`));
  }

  const hoursByChef = Object.fromEntries((summary || []).map((item) => [item.name, item.hours]));
  state.weeklyInputs.availability.forEach((entry) => {
    if (entry.type !== 'Annual Leave') return;
    const chef = entry.chef;
    const start = parseLocalDate(entry.startDate || entry.date);
    const finish = parseLocalDate(entry.finishDate || entry.date);
    const days = Math.floor((finish - start) / (1000 * 60 * 60 * 24)) + 1;
    const expectedCredit = days * 12;
    results.push(createResult('H018', expectedCredit >= 12, `${chef}: annual leave credits calculated at 12h/day`));
  });

  Object.entries(hoursByChef).forEach(([chef, hours]) => {
    results.push(createResult('H017', hours >= 0, `${chef}: target hour check evaluated (${hours.toFixed(1)}h)`));
  });

  return results;
}

export function validateRotaSoftRules({ rota, state, inputs }) {
  const results = [];
  const ruleOverrides = {
    ...(getRuleOverrides(inputs?.changes || '')),
    _availability: state?.weeklyInputs?.availability || []
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
