import { SCORING_WEIGHTS, SHIFT_LENGTHS } from './constants.js';
import { getSectionLevel, getSectionLevelLabel, SECTION_LEVELS } from './section-levels.js';

export function getSectionScore(staff, section, ruleOverrides) {
  return getSectionLevel(staff, section);
}

export function getPreferredDayOffPenalty(staff, dayName) {
  return Array.isArray(staff?.preferredDaysOff) && staff.preferredDaysOff.includes(dayName) ? 8 : 0;
}

export function isSenior(staff) {
  return staff?.senior === true;
}

function getSoftRuleWeight(state, ruleId, fallbackWeight) {
  const rules = state?.settings?.rules || [];
  const rule = rules.find((item) => item.id === ruleId && item.type === 'soft' && item.enabled !== false);
  return typeof rule?.weight === 'number' ? rule.weight : fallbackWeight;
}

export function getQualityScore(staff, section) {
  return getSectionLevel(staff, section);
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
  const preferredDayOffWeight = getSoftRuleWeight(state, 'S002', 8);

  const breakfastCounts = {};
  rota.forEach((day) => {
    day.chefs.forEach((chefName) => {
      const chef = state.staff.find((candidate) => candidate.name === chefName);
      if (!chef?.preferredDaysOff?.includes(day.dayName)) return;
      score -= preferredDayOffWeight;
      explanations.push(`${chefName} worked ${day.dayName} despite a Preferred Day Off because operational requirements took priority.`);
    });

    day.assignments.forEach((assignment) => {
      const chef = state.staff.find((s) => s.name === assignment.chef);
      if (!chef) return;

      if (assignment.section === 'Breakfast') {
        breakfastCounts[chef.name] = (breakfastCounts[chef.name] || 0) + 1;
      }

      const quality = getQualityScore(chef, assignment.section);
      if (quality >= 3) {
        score += SCORING_WEIGHTS.preferredSection;
        if (assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
          explanations.push(`${chef.name} was assigned ${assignment.section} because it is a Preferred section.`);
        }
      } else if (quality === 2) {
        score += SCORING_WEIGHTS.proficientSection;
        if (assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
          explanations.push(`${chef.name} covered ${assignment.section} at Competent level.`);
        }
      } else if (quality === 1) {
        score += SCORING_WEIGHTS.trainingSection;
        if (assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
          const supportedBySenior = day.chefs
            .map((name) => state.staff.find((s) => s.name === name))
            .some((candidate) => candidate && candidate.name !== chef.name && isSenior(candidate));
          if (supportedBySenior) {
            explanations.push(`${chef.name} covered ${assignment.section} as a supervised training allocation while senior and section coverage remained valid.`);
          } else {
            explanations.push(`${chef.name} covered ${assignment.section} at ${getSectionLevelLabel(quality)} level because no materially stronger valid option was available.`);
          }
        }
      } else if (quality === 0 && assignment.section !== 'Breakfast' && assignment.section !== 'MIO') {
        score += SCORING_WEIGHTS.avoidedSectionPenalty;
        explanations.push(`${chef.name} was not used on ${assignment.section} because it is marked ${getSectionLevelLabel(SECTION_LEVELS.SHOULD_NOT_COVER)}.`);
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
