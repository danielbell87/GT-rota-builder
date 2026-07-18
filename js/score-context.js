import { SCORING_WEIGHTS } from './constants.js';
import { getSectionLevel } from './section-levels.js';
import { getGtChefNamesForDay } from './rota-model.js';

function ruleWeight(state, ruleId, fallback) {
  const rule = (state.settings?.rules || []).find((item) => item.id === ruleId && item.enabled !== false);
  return typeof rule?.weight === 'number' ? rule.weight : fallback;
}

function unavailable(chefName, date, availability = []) {
  return availability.some((entry) => {
    if (entry.chef !== chefName || !['Annual Leave', 'Unavailable'].includes(entry.type)) return false;
    const start = entry.startDate || entry.date;
    const finish = entry.finishDate || entry.startDate || entry.date;
    return start <= date && finish >= date;
  });
}

function ratingFor(percentage, valid) {
  if (!valid) return 'Invalid';
  if (percentage >= 90) return 'Excellent';
  if (percentage >= 80) return 'Very good';
  if (percentage >= 70) return 'Good';
  if (percentage >= 60) return 'Acceptable';
  return 'Significant compromises';
}

function sectionPoints(level) {
  if (level >= 3) return SCORING_WEIGHTS.preferredSection;
  if (level === 2) return SCORING_WEIGHTS.proficientSection;
  if (level === 1) return SCORING_WEIGHTS.trainingSection;
  return 0;
}

export function buildContextualScore({ state, week, valid = true }) {
  const rota = week.rota || [];
  const availability = week.inputs?.availability || [];
  const dayOffWeight = ruleWeight(state, 'S002', 8);
  const weekendWeight = ruleWeight(state, 'S004', Math.abs(SCORING_WEIGHTS.weekendFairnessPenalty));
  let preferredAvailable = 0;
  let preferredAchieved = 0;
  let breakfastAvailable = 0;
  let breakfastAchieved = 0;
  let sectionAvailable = 0;
  let sectionAchieved = 0;

  state.staff.forEach((chef) => {
    (chef.preferredDaysOff || []).forEach((dayName) => {
      const day = rota.find((item) => item.dayName === dayName);
      if (!day || unavailable(chef.name, day.date, availability)) return;
      preferredAvailable += dayOffWeight;
      if (!getGtChefNamesForDay(day).includes(chef.name)) preferredAchieved += dayOffWeight;
    });
    if (chef.preferredBreakfast) {
      const day = rota.find((item) => item.dayName === chef.preferredBreakfast);
      if (day && chef.breakfastEligible && !unavailable(chef.name, day.date, availability)) {
        breakfastAvailable += SCORING_WEIGHTS.preferredBreakfastDayBonus;
        if (day.assignments.some((item) => item.section === 'Breakfast' && item.chef === chef.name)) {
          breakfastAchieved += SCORING_WEIGHTS.preferredBreakfastDayBonus;
        }
      }
    }
  });

  rota.forEach((day) => {
    day.assignments
      .filter((assignment) => !['Breakfast', 'MIO', 'Float'].includes(assignment.section))
      .forEach((assignment) => {
        const chef = state.staff.find((item) => item.name === assignment.chef);
        sectionAvailable += SCORING_WEIGHTS.preferredSection;
        sectionAchieved += chef ? sectionPoints(getSectionLevel(chef, assignment.section)) : 0;
      });
  });

  const weekendAvailable = state.staff.length * weekendWeight * 2;
  const weekendPenalty = Math.max(0, week.softScore?.weekendFairnessPenalty || 0);
  const weekendAchieved = Math.max(0, weekendAvailable - Math.min(weekendPenalty, weekendAvailable));
  const categories = [
    { label: 'Preferred days off', achieved: preferredAchieved, available: preferredAvailable },
    { label: 'Weekend fairness', achieved: weekendAchieved, available: weekendAvailable },
    { label: 'Section suitability', achieved: sectionAchieved, available: sectionAvailable },
    { label: 'Breakfast preferences', achieved: breakfastAchieved, available: breakfastAvailable }
  ].filter((item) => item.available > 0);
  const available = categories.reduce((total, item) => total + item.available, 0);
  const achieved = categories.reduce((total, item) => total + item.achieved, 0);
  const percentage = available > 0 ? Math.max(0, Math.min(100, Math.round((achieved / available) * 100))) : 100;
  const rating = ratingFor(percentage, valid);
  const explanation = valid
    ? `This rota meets every required rule and achieves ${percentage >= 80 ? 'most' : 'some'} applicable staff preferences; specific compromises are listed below.`
    : 'This rota is invalid, so no positive quality rating is assigned.';
  return { achieved, available, percentage, rating, explanation, categories, valid };
}

export function combineContextualScores(scores = []) {
  const available = scores.reduce((total, score) => total + score.available, 0);
  const achieved = scores.reduce((total, score) => total + score.achieved, 0);
  const valid = scores.every((score) => score.valid);
  const percentage = available > 0 ? Math.max(0, Math.min(100, Math.round((achieved / available) * 100))) : 100;
  return { achieved, available, percentage, rating: ratingFor(percentage, valid), valid };
}
