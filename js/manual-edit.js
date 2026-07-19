import { DISPLAY_SECTIONS, SHIFT_LENGTHS } from './constants.js';
import { validateRotaHardRules, validateRotaSoftRules } from './validation.js?v=20260719s';
import { scoreSoftPreferences } from './scoring.js?v=20260719s';
import { buildRotaDiagnostics } from './diagnostics.js?v=20260719s';
import { getGtChefNamesForDay, hasGtAssignment, syncDayGtChefs } from './rota-model.js?v=20260719s';

export const MANUAL_HISTORY_LIMIT = 10;
export const MANUALLY_EDITABLE_SECTIONS = DISPLAY_SECTIONS.filter((section) => section !== 'MIO');

export function createGenerationId(overallResult) {
  return (overallResult?.weeks || []).map((week) => `${week.weekStart}:${week.rota?.map((day) => day.date).join(',') || ''}`).join('|');
}

export function cellKey(weekStart, date, section) {
  return `${weekStart}__${date}__${section}`;
}

export function ensureManualEditState(state, overallResult = state.generatedRotas.latestResult) {
  const generationId = overallResult ? createGenerationId(overallResult) : '';
  const current = state.manualEditing;
  if (!current || current.generationId !== generationId) {
    state.manualEditing = {
      generationId,
      originals: {},
      edits: {},
      undo: [],
      redo: [],
      actions: []
    };
  }
  return state.manualEditing;
}

export function getCellChef(week, date, section) {
  return getCellChefs(week, date, section)[0] || '';
}

export function getCellChefs(week, date, section) {
  const day = week?.rota?.find((item) => item.date === date);
  return (day?.assignments || [])
    .filter((item) => item.section === section)
    .map((item) => item.chef);
}

function setCellChefs(week, date, section, chefs) {
  const day = week.rota.find((item) => item.date === date);
  if (!day) return false;
  day.assignments = (day.assignments || []).filter((item) => item.section !== section);
  [...new Set((Array.isArray(chefs) ? chefs : [chefs]).filter(Boolean))].forEach((chef) => {
    day.assignments.push({ section, chef });
  });
  syncDayGtChefs(day);
  return true;
}

function setCellChef(week, date, section, chef) {
  return setCellChefs(week, date, section, chef ? [chef] : []);
}

function snapshot(overallResult, manual) {
  return {
    weeks: structuredClone(overallResult.weeks),
    originals: { ...manual.originals },
    edits: { ...manual.edits },
    actions: structuredClone(manual.actions || [])
  };
}

function restore(overallResult, manual, value) {
  overallResult.weeks = structuredClone(value.weeks);
  manual.originals = { ...value.originals };
  manual.edits = { ...value.edits };
  manual.actions = structuredClone(value.actions || []);
}

function pushUndo(overallResult, manual) {
  manual.undo.push(snapshot(overallResult, manual));
  if (manual.undo.length > MANUAL_HISTORY_LIMIT) manual.undo.shift();
  manual.redo = [];
}

export function findDuplicateCoreAssignment(week, date, section, chef) {
  if (!chef || section === 'Breakfast') return null;
  const day = week.rota.find((item) => item.date === date);
  return day?.assignments?.find((item) => item.chef === chef && item.section !== 'Breakfast' && item.section !== 'MIO' && item.section !== section) || null;
}

export function applyManualAssignment({ state, overallResult, weekIndex, date, section, chef, duplicateAction = '', floatAction = 'add' }) {
  const manual = ensureManualEditState(state, overallResult);
  const week = overallResult.weeks[weekIndex];
  if (!week || !MANUALLY_EDITABLE_SECTIONS.includes(section)) return { applied: false, reason: 'Cell is not editable.' };
  const key = cellKey(week.weekStart, date, section);
  const previousChefs = getCellChefs(week, date, section);
  const previousChef = getCellChef(week, date, section);
  if (section === 'Float' && floatAction === 'add' && previousChefs.includes(chef)) return { applied: false, reason: 'Chef is already assigned to Float.' };
  if (section === 'Float' && floatAction === 'remove' && !previousChefs.includes(chef)) return { applied: false, reason: 'Chef is not assigned to Float.' };
  if (section !== 'Float' && previousChef === chef) return { applied: false, reason: 'No change.' };
  const duplicate = section === 'Float' && floatAction === 'remove'
    ? null
    : findDuplicateCoreAssignment(week, date, section, chef);
  if (duplicate && !duplicateAction) return { applied: false, duplicate, previousChef };
  if (duplicate && duplicateAction === 'cancel') return { applied: false, cancelled: true };
  if (duplicate && duplicateAction === 'swap' && (section === 'Float' || !previousChef)) {
    return { applied: false, reason: section === 'Float'
      ? 'Float additions can move the chef from another GT section, but cannot swap the whole Float cell.'
      : 'Swap is unavailable because the target section is unfilled.' };
  }
  pushUndo(overallResult, manual);
  if (!Object.prototype.hasOwnProperty.call(manual.originals, key)) manual.originals[key] = section === 'Float' ? previousChefs : previousChef;
  if (duplicate) {
    const duplicateKey = cellKey(week.weekStart, date, duplicate.section);
    if (!Object.prototype.hasOwnProperty.call(manual.originals, duplicateKey)) manual.originals[duplicateKey] = duplicate.chef;
    if (duplicateAction === 'swap' && previousChef) {
      setCellChef(week, date, duplicate.section, previousChef);
      manual.edits[duplicateKey] = previousChef;
    } else {
      setCellChef(week, date, duplicate.section, '');
      manual.edits[duplicateKey] = '';
    }
  }
  if (section === 'Float') {
    const nextChefs = chef
      ? (floatAction === 'remove' ? previousChefs.filter((name) => name !== chef) : [...previousChefs, chef])
      : [];
    setCellChefs(week, date, section, nextChefs);
    manual.edits[key] = [...new Set(nextChefs)];
  } else {
    setCellChef(week, date, section, chef);
    manual.edits[key] = chef;
  }
  recalculateEditedResult(state, overallResult);
  const dayName = week.rota.find((day) => day.date === date)?.dayName || date;
  let description;
  if (duplicateAction === 'swap') description = `${chef} and ${previousChef} swapped`;
  else if (section === 'Float') description = chef
    ? `${chef} ${floatAction === 'remove' ? 'removed from' : 'added to'} ${dayName} Float`
    : `${dayName} Float cleared`;
  else if (!chef) description = `${section} assignment cleared`;
  else if (previousChef) description = `${previousChef} replaced by ${chef} on ${section}`;
  else description = `${chef} added to ${dayName} ${section}`;
  manual.actions = [{ description, at: Date.now() }, ...(manual.actions || [])].slice(0, MANUAL_HISTORY_LIMIT);
  return { applied: true, previousChef, previousChefs, chef, description };
}

export function undoManualEdit(state, overallResult) {
  const manual = ensureManualEditState(state, overallResult);
  const previous = manual.undo.pop();
  if (!previous) return false;
  manual.redo.push(snapshot(overallResult, manual));
  restore(overallResult, manual, previous);
  recalculateEditedResult(state, overallResult);
  return true;
}

export function redoManualEdit(state, overallResult) {
  const manual = ensureManualEditState(state, overallResult);
  const next = manual.redo.pop();
  if (!next) return false;
  manual.undo.push(snapshot(overallResult, manual));
  restore(overallResult, manual, next);
  recalculateEditedResult(state, overallResult);
  return true;
}

export function resetManualCell(state, overallResult, weekIndex, date, section) {
  const manual = ensureManualEditState(state, overallResult);
  const week = overallResult.weeks[weekIndex];
  const key = cellKey(week.weekStart, date, section);
  if (!Object.prototype.hasOwnProperty.call(manual.originals, key)) return false;
  pushUndo(overallResult, manual);
  if (section === 'Float') setCellChefs(week, date, section, manual.originals[key]);
  else setCellChef(week, date, section, manual.originals[key]);
  delete manual.originals[key];
  delete manual.edits[key];
  recalculateEditedResult(state, overallResult);
  return true;
}

export function resetAllManualEdits(state, overallResult) {
  const manual = ensureManualEditState(state, overallResult);
  if (!Object.keys(manual.originals).length) return false;
  pushUndo(overallResult, manual);
  overallResult.weeks.forEach((week) => week.rota.forEach((day) => MANUALLY_EDITABLE_SECTIONS.forEach((section) => {
    const key = cellKey(week.weekStart, day.date, section);
    if (!Object.prototype.hasOwnProperty.call(manual.originals, key)) return;
    if (section === 'Float') setCellChefs(week, day.date, section, manual.originals[key]);
    else setCellChef(week, day.date, section, manual.originals[key]);
  })));
  manual.originals = {};
  manual.edits = {};
  recalculateEditedResult(state, overallResult);
  return true;
}

function rebuildSummary(state, week) {
  const previous = Object.fromEntries((week.summary || []).map((item) => [item.name, item]));
  return state.staff.map((chef) => {
    const gtDays = week.rota.filter((day) => hasGtAssignment(day, chef.name)).length;
    const gtHours = week.rota.reduce((total, day) => total + (hasGtAssignment(day, chef.name) ? (SHIFT_LENGTHS.regularByDay[day.dayName] || 0) : 0), 0);
    const mioDays = week.rota.filter((day) => day.assignments.some((item) => item.section === 'MIO' && item.chef === chef.name)).length;
    const mioHours = mioDays * SHIFT_LENGTHS.mio;
    const annualLeaveHours = previous[chef.name]?.annualLeaveHours || 0;
    return { ...previous[chef.name], name: chef.name, count: gtDays, gtDays, gtHours, mioDays, mioHours, floatDays: week.rota.filter((day) => day.assignments.some((item) => item.section === 'Float' && item.chef === chef.name)).length, annualLeaveHours, totalCreditedHours: gtHours + mioHours + annualLeaveHours, hours: gtHours + mioHours + annualLeaveHours };
  });
}

export function recalculateEditedResult(state, overallResult) {
  (overallResult.weeks || []).forEach((week) => {
    week.summary = rebuildSummary(state, week);
    week.hardValidation = validateRotaHardRules({ rota: week.rota, state, inputs: week.inputs || {}, summary: week.summary, fullWeekDates: week.fullWeekDates });
    week.softValidation = validateRotaSoftRules({ rota: week.rota, state, inputs: week.inputs || {} });
    week.softScore = scoreSoftPreferences({ state, rota: week.rota, hardValidation: week.hardValidation });
    week.validationIssues = week.hardValidation.filter((result) => result.passed === false);
    week.preferenceCompromises = week.softValidation.filter((result) => result.passed === false);
    week.fullyValid = week.validationIssues.length === 0;
    week.score = week.softScore.score;
    week.referenceScore = 100;
    week.diagnostics = buildRotaDiagnostics({ state, week, hardValidation: week.hardValidation, softScore: week.softScore });
    week.status = week.hardValidation.every((result) => result.passed) ? 'ok' : (week.rota.length >= 7 ? 'invalid' : 'incomplete');
  });
  overallResult.status = (overallResult.weeks || []).every((week) => week.status === 'ok') ? 'ok' : 'invalid';
  if ((overallResult.weeks || []).length > 1) {
    overallResult.fairnessSummary = state.staff.map((chef) => {
      const worked = { Friday: 0, Saturday: 0, Sunday: 0 };
      (overallResult.weeks || []).forEach((week) => week.rota.forEach((day) => {
        if (Object.prototype.hasOwnProperty.call(worked, day.dayName) && day.assignments.some((item) => item.chef === chef.name)) worked[day.dayName] += 1;
      }));
      return { name: chef.name, fridayCount: worked.Friday, saturdayCount: worked.Saturday, sundayCount: worked.Sunday, weightedBurden: worked.Friday * 3 + worked.Saturday * 4 + worked.Sunday * 4, friSatBlocksOff: 0, satSunBlocksOff: 0, latestWeekendBlock: '', duePriority: false };
    });
  }
  return overallResult;
}

export function getChefConcerns({ state, week, date, section, chefName }) {
  if (!chefName) return [];
  const chef = state.staff.find((item) => item.name === chefName);
  const day = week.rota.find((item) => item.date === date);
  const concerns = [];
  (week.inputs?.availability || state.weeklyInputs.availability || []).forEach((entry) => {
    if (entry.chef !== chefName || date < (entry.startDate || entry.date) || date > (entry.finishDate || entry.date)) return;
    concerns.push(entry.type === 'Annual Leave' ? 'Annual leave' : 'Unavailable');
  });
  if (section !== 'Breakfast' && section !== 'Float') {
    const level = Number(chef?.skills?.[section] ?? 0);
    if (level === 0) concerns.push('Should not cover this section');
    if (level === 1) concerns.push('In training');
  }
  if (day?.assignments.some((item) => item.chef === chefName && item.section !== 'Breakfast' && item.section !== 'MIO' && item.section !== section)) concerns.push('Already assigned elsewhere that day');
  const summary = week.summary?.find((item) => item.name === chefName);
  if ((summary?.gtDays || 0) >= (summary?.adjustedGtTarget ?? 4) && !hasGtAssignment(day, chefName)) concerns.push('Would exceed weekly target');
  return [...new Set(concerns)];
}
