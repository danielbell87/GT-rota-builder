import { DAY_FAIRNESS_WEIGHTS, SCORING_WEIGHTS, SHIFT_LENGTHS } from './constants.js';
import { getSectionLevel, getSectionLevelLabel, SECTION_LEVELS } from './section-levels.js';
import { getGtChefNamesForDay } from './rota-model.js?v=20260719t';

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

function getWorkedDaysByChef(state, rota) {
  const workedDaysByChef = Object.fromEntries(state.staff.map((chef) => [chef.name, new Set()]));
  rota.forEach((day) => {
    getGtChefNamesForDay(day).forEach((chefName) => workedDaysByChef[chefName]?.add(day.dayName));
  });
  return workedDaysByChef;
}

function getWeekendPattern(workedDays) {
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .filter((dayName) => workedDays.has(dayName));
  return {
    dayNames,
    weightedBurden: dayNames.reduce((total, dayName) => total + (DAY_FAIRNESS_WEIGHTS[dayName] || 0), 0),
    saturdaySundayPair: workedDays.has('Saturday') && workedDays.has('Sunday'),
    fullWeekend: workedDays.has('Friday') && workedDays.has('Saturday') && workedDays.has('Sunday'),
    signature: dayNames.join('|')
  };
}

function getWeekendOffBlock(workedDays, unavailableDays = new Set()) {
  const off = (dayName) => !workedDays.has(dayName) && !unavailableDays.has(dayName);
  const fridayOff = off('Friday');
  const saturdayOff = off('Saturday');
  const sundayOff = off('Sunday');
  const fullWeekendOff = fridayOff && saturdayOff && sundayOff;
  return {
    fridayOff,
    saturdayOff,
    sundayOff,
    fullWeekendOff,
    satSunBlock: saturdayOff && sundayOff,
    friSatBlock: fridayOff && saturdayOff && !sundayOff,
    isolatedDays: [fridayOff, saturdayOff, sundayOff].filter(Boolean).length
  };
}

export function scoreSoftPreferences({ state, rota, hardValidation = [], fairnessContext = null }) {
  const hardFailed = hardValidation.some((result) => !result.passed);
  let score = 100;
  let preferredDayOffViolationCount = 0;
  let preferredDayOffPenalty = 0;
  let weekendFairnessPenalty = 0;
  let weekendStreakPenalty = 0;
  let weekendBlockFairnessPenalty = 0;
  const explanations = [];
  const seniorOnPassWeight = getSoftRuleWeight(state, 'prefer-senior-on-pass', 12);
  const preferredDayOffWeight = getSoftRuleWeight(state, 'S002', 8);
  const consecutiveDaysOffWeight = getSoftRuleWeight(state, 'S003', SCORING_WEIGHTS.twoConsecutiveDaysOffBonus);
  const weekendFairnessWeight = getSoftRuleWeight(state, 'S004', Math.abs(SCORING_WEIGHTS.weekendFairnessPenalty));
  const seniorDistributionWeight = getSoftRuleWeight(state, 'S006', SCORING_WEIGHTS.seniorDistributionBonus);

  const breakfastCounts = {};
  rota.forEach((day) => {
    const floatCount = day.assignments.filter((assignment) => assignment.section === 'Float').length;
    if (floatCount > 1) {
      const penalty = floatCount - 1;
      score -= penalty;
      explanations.push(`${day.dayName} uses ${floatCount} Float chefs to satisfy hard staffing targets.`);
    }
    getGtChefNamesForDay(day).forEach((chefName) => {
      const chef = state.staff.find((candidate) => candidate.name === chefName);
      if (!chef?.preferredDaysOff?.includes(day.dayName)) return;
      score -= preferredDayOffWeight;
      preferredDayOffViolationCount += 1;
      preferredDayOffPenalty += preferredDayOffWeight;
      explanations.push(`${chefName} worked ${day.dayName} despite a Preferred Day Off because satisfying hard constraints required the compromise.`);
    });

    day.assignments.forEach((assignment) => {
      const chef = state.staff.find((s) => s.name === assignment.chef);
      if (!chef) return;

      if (assignment.section === 'Breakfast') {
        breakfastCounts[chef.name] = (breakfastCounts[chef.name] || 0) + 1;
        if (chef.preferredBreakfast === day.dayName) {
          score += SCORING_WEIGHTS.preferredBreakfastDayBonus;
        }
        return;
      }
      if (assignment.section === 'Float' || assignment.section === 'MIO') return;

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
          const supportedBySenior = getGtChefNamesForDay(day)
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

  const workedDaysByChef = getWorkedDaysByChef(state, rota);
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  Object.entries(workedDaysByChef).forEach(([name, workedDays]) => {
    const hasConsecutiveDaysOff = weekdays.some((dayName, index) => (
      index < weekdays.length - 1
      && !workedDays.has(dayName)
      && !workedDays.has(weekdays[index + 1])
    ));
    if (hasConsecutiveDaysOff) score += consecutiveDaysOffWeight;
  });

  const weekendLoads = Object.fromEntries(
    state.staff
      .filter((chef) => workedDaysByChef[chef.name]?.size > 0)
      .map((chef) => [chef.name, 0])
  );
  rota
    .filter((day) => ['Friday', 'Saturday', 'Sunday'].includes(day.dayName))
    .forEach((day) => {
      getGtChefNamesForDay(day).forEach((name) => {
        weekendLoads[name] = (weekendLoads[name] || 0) + 1;
      });
    });
  const weekendValues = Object.values(weekendLoads);
  if (weekendValues.length > 1) {
    const max = Math.max(...weekendValues);
    const min = Math.min(...weekendValues);
    const spread = max - min;
    if (spread > 1) {
      const penalty = weekendFairnessWeight * (spread - 1);
      score -= penalty;
      weekendFairnessPenalty += penalty;
      explanations.push('Weekend load distribution is uneven.');
    }
  }

  ['Friday', 'Saturday', 'Sunday'].forEach((dayName) => {
    const day = rota.find((candidate) => candidate.dayName === dayName);
    if (!day) return;
    const seniorCount = getGtChefNamesForDay(day)
      .map((name) => state.staff.find((chef) => chef.name === name))
      .filter((chef) => isSenior(chef)).length;
    if (seniorCount >= 2) score += seniorDistributionWeight;
  });

  if (fairnessContext) {
    const projectedBurdens = [];
    const projectedBlocks = {};
    Object.entries(workedDaysByChef).forEach(([name, workedDays]) => {
      const pattern = getWeekendPattern(workedDays);
      const historicStats = fairnessContext.stats?.[name] || {};
      const previous = fairnessContext.previousWeekPatterns?.[name];
      projectedBurdens.push((historicStats.weightedBurden || 0) + pattern.weightedBurden);
      const block = getWeekendOffBlock(
        workedDays,
        fairnessContext.currentUnavailableWeekendDays?.[name] || new Set()
      );
      const preferred = state.staff.find((chef) => chef.name === name)?.preferredDaysOff || [];
      const naturalFullWeekend = ['Friday', 'Saturday', 'Sunday'].every((day) => preferred.includes(day));
      const blockCredit = block.satSunBlock ? 12 : (block.friSatBlock ? 10 : block.isolatedDays);
      const fullWeekendPenalty = block.fullWeekendOff && !naturalFullWeekend ? 7 : 0;
      projectedBlocks[name] = {
        credit: blockCredit - fullWeekendPenalty,
        receivesBlock: block.satSunBlock || block.friSatBlock
      };
      weekendBlockFairnessPenalty -= blockCredit - fullWeekendPenalty;

      if (previous?.saturdaySundayPair && pattern.saturdaySundayPair) {
        const projectedStreak = (historicStats.consecutiveSaturdaySundayWeeks || 0) + 1;
        const streakPenalty = weekendFairnessWeight * (projectedStreak >= 3 ? 30 : projectedStreak ** 2);
        score -= streakPenalty;
        weekendFairnessPenalty += streakPenalty;
        weekendStreakPenalty += streakPenalty;
        explanations.push(`${name} would work Saturday and Sunday for ${projectedStreak} consecutive weeks.`);
      }
      if (previous?.fullWeekend && pattern.fullWeekend) {
        score -= weekendFairnessWeight;
        weekendFairnessPenalty += weekendFairnessWeight;
      }
      if (previous?.signature && previous.signature === pattern.signature) {
        score -= weekendFairnessWeight / 2;
        weekendFairnessPenalty += weekendFairnessWeight / 2;
      }
    });

    Object.entries(projectedBlocks).forEach(([name, projected]) => {
      const stats = fairnessContext.stats?.[name] || {};
      const peers = (stats.compatibleColleagues || [])
        .map((peerName) => ({ name: peerName, stats: fairnessContext.stats?.[peerName], projected: projectedBlocks[peerName] }))
        .filter((peer) => peer.stats);
      if (!peers.length || !projected.receivesBlock) return;
      const ownTotal = (stats.friSatBlocksOff || 0) + (stats.satSunBlocksOff || 0);
      const mostDuePeer = peers.reduce((best, peer) => (
        !best || (peer.stats.weeksSinceWeekendBlock || 0) > (best.stats.weeksSinceWeekendBlock || 0) ? peer : best
      ), null);
      const peerTotal = (mostDuePeer.stats.friSatBlocksOff || 0) + (mostDuePeer.stats.satSunBlocksOff || 0);
      if ((mostDuePeer.stats.weeksSinceWeekendBlock || 0) > (stats.weeksSinceWeekendBlock || 0)
        || (ownTotal > peerTotal && !mostDuePeer.projected?.receivesBlock)) {
        weekendBlockFairnessPenalty += weekendFairnessWeight * 6;
      }
    });

    if (projectedBurdens.length > 1) {
      const projectedSpread = Math.max(...projectedBurdens) - Math.min(...projectedBurdens);
      const projectedSpreadPenalty = projectedSpread * (weekendFairnessWeight / 4);
      score -= projectedSpreadPenalty;
      weekendFairnessPenalty += projectedSpreadPenalty;
      explanations.push(`Multi-week fairness burden spread after this rota: ${projectedSpread.toFixed(1)}.`);
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
      const seniorChefsOnDay = getGtChefNamesForDay(day)
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
      preferredDayOffViolationCount,
      preferredDayOffPenalty,
      weekendFairnessPenalty,
      weekendStreakPenalty,
      weekendBlockFairnessPenalty,
      explanation: ['Hard-rule failure detected; score capped.', ...explanations]
    };
  }

  return {
    valid: true,
    score,
    capped: false,
    preferredDayOffViolationCount,
    preferredDayOffPenalty,
    weekendFairnessPenalty,
    weekendStreakPenalty,
    weekendBlockFairnessPenalty,
    explanation: explanations
  };
}
