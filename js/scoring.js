import { ROLE_WEIGHT, SCORING_WEIGHTS, SHIFT_LENGTHS } from './constants.js';

export function getSectionScore(staff, section, ruleOverrides) {
  let score = staff.skills?.[section] ?? 0;
  score += ruleOverrides.preferredSections?.[staff.name]?.[section] || 0;
  score -= ruleOverrides.avoidedSections?.[staff.name]?.[section] || 0;
  return score;
}

export function getRoleWeight(staff) {
  return ROLE_WEIGHT[staff?.role] || 0;
}

export function getRoleBonus(staff, dayName) {
  const rank = getRoleWeight(staff);
  let bonus = rank * 0.4;
  if (['Friday', 'Saturday', 'Sunday'].includes(dayName) && rank >= ROLE_WEIGHT['Sous Chef']) bonus += 1;
  if (rank >= ROLE_WEIGHT['Head Chef']) bonus += 1;
  return bonus;
}

export function getSoftRulePenalty(staffName, dayName) {
  if (staffName === 'Aled' && ['Saturday', 'Sunday'].includes(dayName)) return 8;
  if (staffName === 'Charlie' && dayName === 'Tuesday') return 8;
  return 0;
}

export function isSenior(staff) {
  if (staff?.senior === true) return true;
  if (staff?.seniorStatus === true) return true;
  return getRoleWeight(staff) >= ROLE_WEIGHT['Sous Chef'];
}

function getSoftRuleWeight(state, ruleId, fallbackWeight) {
  const rules = state?.settings?.rules || [];
  const rule = rules.find((item) => item.id === ruleId && item.type === 'soft' && item.enabled !== false);
  return typeof rule?.weight === 'number' ? rule.weight : fallbackWeight;
}

export function getQualityScore(staff, section) {
  return staff.skills?.[section] ?? 0;
}

export function getHoursForDay(dayName, isBreakfast = false) {
  const base = SHIFT_LENGTHS.regularByDay?.[dayName] ?? 11.5;
  if (isBreakfast) return base;
  return base;
}

export function getHoursForAssignment(dayName, section) {
  if (section === 'MIO') return SHIFT_LENGTHS.mio;
  return getHoursForDay(dayName, section === 'Breakfast');
}

export function scoreSoftPreferences({ state, rota, hardValidation }) {
  const hardFailed = hardValidation.some((result) => !result.passed);
  let score = 100;
  const explanations = [];
  const seniorOnPassWeight = getSoftRuleWeight(state, 'prefer-senior-on-pass', 12);

  const breakfastCounts = {};
  rota.forEach((day) => {
    day.assignments.forEach((assignment) => {
      const chef = state.staff.find((s) => s.name === assignment.chef);
      if (!chef) return;

      if (assignment.section === 'Breakfast') {
        breakfastCounts[chef.name] = (breakfastCounts[chef.name] || 0) + 1;
      }

      const quality = getQualityScore(chef, assignment.section);
      if (quality >= 3) {
        score += SCORING_WEIGHTS.preferredSection;
      } else if (quality === 2) {
        score += SCORING_WEIGHTS.proficientSection;
      } else if (quality === 1) {
        score += SCORING_WEIGHTS.trainingSection;
      } else if (quality === 0 && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        score += SCORING_WEIGHTS.avoidedSectionPenalty;
        explanations.push(`${chef.name} assigned to a weak-fit section (${assignment.section}).`);
      }
    });
  });

  Object.entries(breakfastCounts).forEach(([name, count]) => {
    if (count > 1) {
      score += SCORING_WEIGHTS.breakfastFairnessPenalty * (count - 1);
      explanations.push(`${name} received ${count} breakfast shifts.`);
    }
  });

  const weekendLoads = {};
  rota
    .filter((day) => ['Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .forEach((day) => {
      day.chefs.forEach((name) => {
        weekendLoads[name] = (weekendLoads[name] || 0) + 1;
      });
    });
  const weekendValues = Object.values(weekendLoads);
  if (weekendValues.length > 1) {
    const max = Math.max(...weekendValues);
    const min = Math.min(...weekendValues);
    if (max - min > 2) {
      score += SCORING_WEIGHTS.weekendFairnessPenalty;
      explanations.push('Weekend load distribution is uneven.');
    }
  }

  rota
    .filter((day) => ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .forEach((day) => {
      const passAssignments = day.assignments.filter((assignment) => assignment.section === 'Pass');
      if (!passAssignments.length) return;

      const passAssignment = passAssignments[0];
      const passChef = state.staff.find((chef) => chef.name === passAssignment.chef);
      const passChefIsSenior = isSenior(passChef);
      const seniorChefsOnDay = day.chefs
        .map((name) => state.staff.find((chef) => chef.name === name))
        .filter((chef) => chef && isSenior(chef));

      if (!seniorChefsOnDay.length) {
        explanations.push(`${day.dayName}: Pass covered by ${passAssignment.chef} with no senior chef available on GT.`);
        return;
      }

      if (!passChefIsSenior) {
        const availableSeniorNames = seniorChefsOnDay.map((chef) => chef.name).join(', ');
        score -= seniorOnPassWeight;
        explanations.push(`${day.dayName}: Pass assigned to ${passAssignment.chef} while senior coverage was available (${availableSeniorNames}).`);
        return;
      }

      score += seniorOnPassWeight;
      explanations.push(`${day.dayName}: Senior chef ${passAssignment.chef} assigned to Pass.`);

      const passChefScore = getQualityScore(passChef, 'Pass');
      const bestSeniorPassScore = Math.max(...seniorChefsOnDay.map((chef) => getQualityScore(chef, 'Pass')));
      if (passChefScore < bestSeniorPassScore) {
        score -= 2;
        explanations.push(`${day.dayName}: A higher Pass-skilled senior was available than ${passAssignment.chef}.`);
      }
    });

  if (hardFailed) {
    return {
      valid: false,
      score: Math.min(score, 80),
      capped: true,
      explanation: ['Hard-rule failure detected; score capped.', ...explanations]
    };
  }

  return {
    valid: true,
    score,
    capped: false,
    explanation: explanations
  };
}
