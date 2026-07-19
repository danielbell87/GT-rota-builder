import { getState, resetStateToDefaults } from '../js/state.js';
import { buildRota } from '../js/solver.js';
import {
  applyManualAssignment,
  ensureManualEditState,
  findDuplicateCoreAssignment,
  recalculateEditedResult,
  redoManualEdit,
  resetAllManualEdits,
  resetManualCell,
  undoManualEdit
} from '../js/manual-edit.js';
import { explainHardRuleFailure } from '../js/render.js';
import { getGtChefNamesForDay, syncDayGtChefs } from '../js/rota-model.js';

function makeOverall() {
  const state = getState();
  const inputs = { ...state.weeklyInputs, weekStart: '2026-07-13', numWeeks: 1, mioChef: '' };
  const result = buildRota(inputs);
  return { status: result.status, numberOfWeeks: 1, weeks: [{ ...result, weekIndex: 0, weekNumber: 1, weekStart: inputs.weekStart, inputs }] };
}

export async function runManualEditTests(assert) {
  resetStateToDefaults();
  const state = getState();
  const overall = makeOverall();
  ensureManualEditState(state, overall);
  const week = overall.weeks[0];
  const day = week.rota[0];
  const currentDay = () => overall.weeks[0].rota.find((item) => item.date === day.date);
  const sauce = day.assignments.find((item) => item.section === 'Sauce');
  const garnish = day.assignments.find((item) => item.section === 'Garnish');
  const originalSauce = sauce.chef;

  const normal = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: day.date, section: 'Sauce', chef: '' });
  assert(normal.applied && !day.assignments.some((item) => item.section === 'Sauce'), 'Manual edit: selecting None updates the rota model');
  assert(JSON.stringify(day.chefs) === JSON.stringify(getGtChefNamesForDay(day)), 'Manual edit: visible GT assignments and day.chefs remain synchronized');
  assert(week.hardValidation.some((item) => item.passed === false), 'Manual edit: validation recalculates after an uncovered section');
  assert(!Object.prototype.hasOwnProperty.call(state.manualEditing, 'locks'), 'Manual edit: lock state is not created');
  const uncoveredFailure = week.hardValidation.find((item) => item.ruleId === 'H025' && item.passed === false && item.message.includes('Sauce'));
  assert(explainHardRuleFailure(uncoveredFailure, week, state).includes('Sauce is uncovered on 13 Jul 2026'), 'Manual edit: invalid edits produce a specific dated hard-rule explanation');
  assert(undoManualEdit(state, overall) && currentDay().assignments.some((item) => item.section === 'Sauce' && item.chef === originalSauce), 'Manual edit: undo restores the assignment');
  assert(JSON.stringify(currentDay().chefs) === JSON.stringify(getGtChefNamesForDay(currentDay())), 'Manual edit: undo restores synchronized GT staffing');
  assert(redoManualEdit(state, overall) && !currentDay().assignments.some((item) => item.section === 'Sauce'), 'Manual edit: redo reapplies the assignment');
  assert(JSON.stringify(currentDay().chefs) === JSON.stringify(getGtChefNamesForDay(currentDay())), 'Manual edit: redo preserves synchronized GT staffing');
  assert(resetManualCell(state, overall, 0, day.date, 'Sauce') && currentDay().assignments.some((item) => item.section === 'Sauce' && item.chef === originalSauce), 'Manual edit: reset cell restores the generated chef');

  const duplicate = findDuplicateCoreAssignment(overall.weeks[0], day.date, 'Sauce', garnish.chef);
  assert(duplicate?.section === 'Garnish', 'Manual edit: duplicate core assignments are detected before applying');
  const moved = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: day.date, section: 'Sauce', chef: garnish.chef, duplicateAction: 'move' });
  assert(moved.applied && !currentDay().assignments.some((item) => item.section === 'Garnish') && currentDay().assignments.some((item) => item.section === 'Sauce' && item.chef === garnish.chef), 'Manual edit: move clears the previous core section');
  undoManualEdit(state, overall);
  const swapped = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: day.date, section: 'Sauce', chef: garnish.chef, duplicateAction: 'swap' });
  assert(swapped.applied && currentDay().assignments.some((item) => item.section === 'Garnish' && item.chef === originalSauce), 'Manual edit: swap exchanges two core assignments');
  const breakfastChef = currentDay().assignments.find((item) => item.section === 'Breakfast').chef;
  assert(findDuplicateCoreAssignment(overall.weeks[0], day.date, 'Breakfast', breakfastChef) === null, 'Manual edit: Breakfast permits a chef who also has one core assignment');
  assert(resetAllManualEdits(state, overall) && Object.keys(state.manualEditing.edits).length === 0, 'Manual edit: reset all clears manual edits');

  const saturday = overall.weeks[0].rota.find((item) => item.dayName === 'Saturday');
  saturday.assignments = saturday.assignments.filter((item) => (
    item.section !== 'Float'
    && !(item.chef === 'Charlie' && item.section !== 'Breakfast' && item.section !== 'MIO')
    && !(item.chef === 'Joel' && item.section !== 'Breakfast' && item.section !== 'MIO')
  ));
  saturday.assignments.push({ chef: 'Charlie', section: 'Float' });
  syncDayGtChefs(saturday);
  recalculateEditedResult(state, overall);
  const appendJoel = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: saturday.date, section: 'Float', chef: 'Joel', floatAction: 'add' });
  assert(appendJoel.applied && saturday.assignments.filter((item) => item.section === 'Float').map((item) => item.chef).join(', ') === 'Charlie, Joel', 'Manual Float: adding Joel appends him after Charlie without replacing Charlie');
  const duplicateJoel = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: saturday.date, section: 'Float', chef: 'Joel', floatAction: 'add' });
  assert(!duplicateJoel.applied && saturday.assignments.filter((item) => item.section === 'Float' && item.chef === 'Joel').length === 1, 'Manual Float: adding Joel twice does not create a duplicate');
  const removeJoel = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: saturday.date, section: 'Float', chef: 'Joel', floatAction: 'remove' });
  assert(removeJoel.applied && saturday.assignments.some((item) => item.section === 'Float' && item.chef === 'Charlie') && !saturday.assignments.some((item) => item.section === 'Float' && item.chef === 'Joel'), 'Manual Float: removing Joel leaves Charlie unchanged');
  const sauceChef = saturday.assignments.find((item) => item.section === 'Sauce')?.chef;
  if (sauceChef) {
    const duplicateGt = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: saturday.date, section: 'Float', chef: sauceChef, floatAction: 'add' });
    assert(!duplicateGt.applied && duplicateGt.duplicate?.section === 'Sauce', 'Manual Float: a chef already covering Sauce cannot also be appended to Float');
    const invalidFloatSwap = applyManualAssignment({ state, overallResult: overall, weekIndex: 0, date: saturday.date, section: 'Float', chef: sauceChef, floatAction: 'add', duplicateAction: 'swap' });
    assert(!invalidFloatSwap.applied && saturday.assignments.some((item) => item.section === 'Float' && item.chef === 'Charlie'), 'Manual Float: whole-cell swaps are rejected so existing Float chefs cannot be displaced or duplicated elsewhere');
  }
}
