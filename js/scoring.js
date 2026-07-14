import { ROLE_WEIGHT, SCORING_WEIGHTS } from './constants.js';

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
  return getRoleWeight(staff) >= ROLE_WEIGHT['Sous Chef'];
}

export function getQualityScore(staff, section) {
  return staff.skills?.[section] ?? 0;
}

export function getHoursForDay(dayName, isBreakfast = false) {
  if (isBreakfast) {
    if (dayName === 'Sunday') return 12.5;
    if (dayName === 'Saturday') return 14.5;
    return 14;
  }
  if (dayName === 'Sunday') return 11;
  if (dayName === 'Saturday') return 12.5;
  return 11.5;
}

export function getHoursForAssignment(dayName, section) {
  if (section === 'MIO') return 9;
  return getHoursForDay(dayName, section === 'Breakfast');
}

export function scoreSoftPreferences({ state, rota, hardValidation }) {
  const hardFailed = hardValidation.some((result) => !result.passed);
  let score = 100;
  const explanations = [];

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
