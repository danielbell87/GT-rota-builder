import { getState, resetStateToDefaults } from '../js/state.js';
import {
  UI_HISTORY_LIMIT,
  closeContextPanel,
  collectIssues,
  comparisonFindings,
  dataSnapshot,
  ensureCoordinatedUiState,
  openContextPanel,
  recordHistory,
  redoDataChange,
  resetView,
  undoDataChange
} from '../js/ui-upgrade.js';

function sampleWeek(weekStart, weekIndex, chef = 'Aled') {
  return {
    weekStart,
    weekIndex,
    weekNumber: weekIndex + 1,
    status: 'ok',
    fullyValid: true,
    hardValidation: [],
    diagnostics: [],
    softScore: { score: 100, weekendFairnessPenalty: 0 },
    rota: [
      { date: weekStart, dayName: 'Monday', assignments: [{ section: 'Breakfast', chef }] },
      { date: `${weekStart.slice(0, -2)}18`, dayName: 'Saturday', assignments: [{ section: 'Sauce', chef }] },
      { date: `${weekStart.slice(0, -2)}19`, dayName: 'Sunday', assignments: [{ section: 'Sauce', chef }] }
    ]
  };
}

export async function runUiUpgradeTests(assert) {
  resetStateToDefaults();
  const state = getState();
  const ui = ensureCoordinatedUiState(state);
  assert(ui.activePanel === null && ['comfortable', 'compact'].includes(ui.viewDensity) && Array.isArray(ui.undoStack), 'UI upgrade: coordinated state has stable defaults and a supported persisted density');

  const before = dataSnapshot(state);
  state.weeklyInputs.numWeeks = 2;
  recordHistory(state, 'Rota length changed', before);
  assert(state.uiState.undoStack.length === 1 && state.uiState.redoStack.length === 0, 'UI upgrade: a deliberate data change creates one bounded undo action');
  assert(undoDataChange(state) === 'Rota length changed' && state.weeklyInputs.numWeeks === 1, 'UI upgrade: unified undo restores underlying data');
  assert(redoDataChange(state) === 'Rota length changed' && state.weeklyInputs.numWeeks === 2, 'UI upgrade: unified redo reapplies underlying data');
  for (let index = 0; index < UI_HISTORY_LIMIT + 5; index += 1) {
    const snapshot = dataSnapshot(state);
    state.weeklyInputs.status = `Draft ${index}`;
    recordHistory(state, `Change ${index}`, snapshot);
  }
  assert(state.uiState.undoStack.length === UI_HISTORY_LIMIT, 'UI upgrade: history is capped at the configured limit');
  undoDataChange(state);
  const fresh = dataSnapshot(state);
  state.weeklyInputs.status = 'New branch';
  recordHistory(state, 'New branch', fresh);
  assert(state.uiState.redoStack.length === 0, 'UI upgrade: a new action after undo clears redo history');

  const first = sampleWeek('2026-07-13', 0);
  const second = sampleWeek('2026-07-20', 1);
  first.hardValidation = [{ passed: false, ruleId: 'H025', date: '2026-07-13', section: 'Sauce', chefName: '', message: '[H025] Sauce is uncovered.' }];
  first.diagnostics = [{ code: 'preferred-day-off-missed', type: 'compromise', date: '2026-07-13', section: 'Sauce', chefId: state.staff[0].id, message: 'Preferred day off could not be met.' }];
  state.generatedRotas.latestResult = { status: 'invalid', numberOfWeeks: 2, weeks: [first, second] };
  const issues = collectIssues(state);
  assert(issues.length === 2 && issues[0].severity === 'error' && issues[1].severity === 'warning', 'UI upgrade: issue navigation orders hard failures before warnings');
  assert(issues[0].weekIndex === 0 && issues[0].date === '2026-07-13' && issues[0].section === 'Sauce', 'UI upgrade: issues retain stable week, date and section context');

  const findings = comparisonFindings(state, 0, 1);
  assert(findings.some((item) => item.type === 'weekend' && item.chef === 'Aled'), 'UI upgrade: comparison detects repeated Saturday-Sunday workload');
  assert(findings.some((item) => item.type === 'breakfast' && item.chef === 'Aled'), 'UI upgrade: comparison detects repeated Breakfast assignment');

  const shell = document.createElement('div');
  shell.id = 'contextPanel';
  document.body.appendChild(shell);
  openContextPanel(state, 'issues');
  openContextPanel(state, 'score');
  assert(document.querySelectorAll('#contextPanel').length === 1 && shell.classList.contains('open') && shell.textContent.includes('Score explanation'), 'UI upgrade: one contextual panel instance swaps content by context');
  assert(closeContextPanel(state) && !shell.classList.contains('open'), 'UI upgrade: contextual panel closes safely');
  state.uiState.manualEditState = { dirtySelection: true };
  openContextPanel(state, 'issues');
  assert(closeContextPanel(state) === false && shell.classList.contains('open'), 'UI upgrade: pending manual selection prevents destructive panel close');
  closeContextPanel(state, { force: true });
  shell.remove();

  state.uiState.comparisonState.active = true;
  state.uiState.fullScreenState = true;
  state.uiState.selectedCell = { date: '2026-07-13' };
  resetView(state);
  assert(!state.uiState.comparisonState.active && !state.uiState.fullScreenState && state.uiState.selectedCell === null, 'UI upgrade: Reset view clears UI-only state without changing rota data');
  assert(state.generatedRotas.latestResult.weeks.length === 2, 'UI upgrade: Reset view preserves generated assignments');
}
