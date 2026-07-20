import { formatDate } from './utils.js';
import { cellKey } from './manual-edit.js';
import { getSectionLevel, getSectionLevelLabel } from './section-levels.js';
import { buildContextualScore } from './score-context.js';

export const UI_HISTORY_LIMIT = 40;
const PREFERENCE_KEY = 'gt-rota-ui-preferences-v1';

const DEFAULT_UI = Object.freeze({
  activePanel: null,
  activePanelContext: null,
  selectedCell: null,
  issueNavigationState: { index: -1, issueId: '' },
  comparisonState: { active: false, weekA: 0, weekB: 1 },
  viewDensity: 'comfortable',
  fullScreenState: false,
  saveState: 'saved',
  undoStack: [],
  redoStack: [],
  toastQueue: [],
  expandedSections: { legend: false },
  manualEditState: null,
  generationState: 'idle'
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function safePreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function ensureCoordinatedUiState(state) {
  const existing = state.uiState || {};
  const saved = typeof localStorage === 'undefined' ? {} : safePreferences();
  state.uiState = {
    ...DEFAULT_UI,
    ...existing,
    viewDensity: saved.viewDensity || existing.viewDensity || DEFAULT_UI.viewDensity,
    expandedSections: {
      ...DEFAULT_UI.expandedSections,
      ...(saved.expandedSections || {}),
      ...(existing.expandedSections || {})
    },
    comparisonState: { ...DEFAULT_UI.comparisonState, ...(existing.comparisonState || {}) },
    issueNavigationState: { ...DEFAULT_UI.issueNavigationState, ...(existing.issueNavigationState || {}) },
    undoStack: Array.isArray(existing.undoStack) ? existing.undoStack : [],
    redoStack: Array.isArray(existing.redoStack) ? existing.redoStack : [],
    toastQueue: []
  };
  return state.uiState;
}

export function persistUiPreferences(state) {
  if (typeof localStorage === 'undefined') return;
  const ui = ensureCoordinatedUiState(state);
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify({
      viewDensity: ui.viewDensity,
      expandedSections: ui.expandedSections
    }));
  } catch {
    // UI preferences are best effort.
  }
}

export function setSaveState(state, value, detail = '') {
  const ui = ensureCoordinatedUiState(state);
  ui.saveState = value;
  ui.saveDetail = detail;
  updateDocumentUiState(state);
}

export function markUnsaved(state, detail = 'Changes are stored locally when saving completes.') {
  setSaveState(state, 'unsaved', detail);
}

export function dataSnapshot(state) {
  return clone({
    staff: state.staff,
    settings: state.settings,
    weeklyInputs: state.weeklyInputs,
    generatedRotas: state.generatedRotas,
    manualEditing: state.manualEditing
  });
}

export function recordHistory(state, description, before) {
  const ui = ensureCoordinatedUiState(state);
  ui.undoStack.push({ description, before, after: dataSnapshot(state) });
  if (ui.undoStack.length > UI_HISTORY_LIMIT) ui.undoStack.shift();
  ui.redoStack = [];
  markUnsaved(state);
}

function restoreSnapshot(state, snapshot) {
  ['staff', 'settings', 'weeklyInputs', 'generatedRotas', 'manualEditing'].forEach((key) => {
    state[key] = clone(snapshot[key]);
  });
  state.availability = state.weeklyInputs.availability;
  state.dailyOverrides = state.weeklyInputs.dailyOverrides;
}

export function undoDataChange(state) {
  const ui = ensureCoordinatedUiState(state);
  const action = ui.undoStack.pop();
  if (!action) return null;
  ui.redoStack.push(action);
  restoreSnapshot(state, action.before);
  markUnsaved(state);
  return action.description;
}

export function redoDataChange(state) {
  const ui = ensureCoordinatedUiState(state);
  const action = ui.redoStack.pop();
  if (!action) return null;
  ui.undoStack.push(action);
  restoreSnapshot(state, action.after);
  markUnsaved(state);
  return action.description;
}

export function openContextPanel(state, type, context = {}) {
  const ui = ensureCoordinatedUiState(state);
  ui.activePanel = type;
  ui.activePanelContext = context;
  renderContextPanel(state);
}

export function closeContextPanel(state, { force = false } = {}) {
  const ui = ensureCoordinatedUiState(state);
  if (!force && ui.manualEditState?.dirtySelection) return false;
  ui.activePanel = null;
  ui.activePanelContext = null;
  ui.manualEditState = null;
  renderContextPanel(state);
  return true;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function panelTitle(type) {
  return {
    issues: 'Rota issues',
    score: 'Score explanation',
    compromise: 'Scheduling compromises',
    assignment: 'Why this assignment?',
    manual: 'Edit assignment',
    save: 'Save details',
    weekly: 'Weekly summary',
    fairness: 'Fairness details',
    availability: 'Leave and availability'
  }[type] || 'Rota details';
}

function assignmentExplanation(state, context) {
  const result = state.generatedRotas.latestResult;
  const week = result?.weeks?.[context.weekIndex];
  const day = week?.rota?.find((item) => item.date === context.date);
  const assignments = (day?.assignments || []).filter((item) => item.section === context.section);
  const names = assignments.map((item) => item.chef);
  const manual = names.some(() => Object.prototype.hasOwnProperty.call(
    state.manualEditing?.edits || {},
    cellKey(week?.weekStart, context.date, context.section)
  ));
  const positives = [];
  const compromises = [];
  const constraints = [];
  names.forEach((name) => {
    const chef = state.staff.find((item) => item.name === name);
    if (chef && !['Breakfast', 'Float', 'MIO'].includes(context.section)) {
      const level = getSectionLevel(chef, context.section);
      if (level >= 2) positives.push(`${getSectionLevelLabel(level)} for ${context.section}`);
      else compromises.push(`${getSectionLevelLabel(level)} for ${context.section}`);
      if (level === 3) positives.push('Preferred section');
    }
    if (chef?.senior) positives.push('Contributes senior cover');
  });
  (week?.diagnostics || []).filter((item) => (
    (item.date || item.section || item.chefId)
    && (!item.date || item.date === context.date)
    && (!item.section || item.section === context.section)
    && (!item.chefId || names.some((name) => state.staff.find((chef) => chef.name === name)?.id === item.chefId))
  )).forEach((item) => {
    if (item.type === 'warning') constraints.push(item.message);
    else if (item.type === 'compromise' || item.type === 'fairness') compromises.push(item.message);
    else if (item.type === 'satisfied') positives.push(item.message);
  });
  const list = (title, values, tone = '') => values.length
    ? `<section class="context-block ${tone}"><h4>${title}</h4><ul>${[...new Set(values)].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`
    : '';
  return `<p class="panel-kicker">${escapeHtml(`Week ${Number(context.weekIndex) + 1} · ${day?.dayName || ''} ${formatDate(context.date)} · ${context.section}`)}</p>
    <h3>${escapeHtml(names.length ? `Why ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} on ${context.section}` : `Why ${context.section} is unfilled`)}</h3>
    ${manual ? '<p class="manual-notice">This assignment was manually selected.</p>' : ''}
    ${list('Positive reasons', positives, 'positive')}
    ${list('Compromises', compromises, 'warning')}
    ${list('Constraints and rule breaks', constraints, 'danger')}
    ${!positives.length && !compromises.length && !constraints.length ? '<p>This assignment was selected as the highest-scoring available option.</p>' : ''}`;
}

function issuePanel(state) {
  const issues = collectIssues(state);
  if (!issues.length) return '<p>No current warnings or hard-rule failures.</p>';
  return `<div class="context-issue-list">${issues.map((issue, index) => `
    <button type="button" class="context-issue ${issue.severity}" data-navigate-issue="${escapeHtml(issue.id)}">
      <span class="issue-severity">${issue.severity === 'error' ? 'Hard failure' : 'Warning'}</span>
      <strong>${escapeHtml(issue.weekLabel)} · ${escapeHtml(issue.day || 'Week')} · ${escapeHtml(issue.section || 'General')}</strong>
      <span>${escapeHtml(issue.chef || 'Vacancy')} · ${escapeHtml(issue.message)}</span>
      <span class="visually-hidden">Issue ${index + 1} of ${issues.length}</span>
    </button>`).join('')}</div>`;
}

function scorePanel(state) {
  const result = state.generatedRotas.latestResult;
  const index = state.uiState.selectedResultWeekIndex || 0;
  const week = result?.weeks?.[index];
  const contextual = week ? buildContextualScore({ state, week, valid: week.fullyValid !== false && week.status === 'ok' }) : null;
  const score = Math.round(contextual?.percentage ?? 0);
  const breakdown = week?.softScore?.breakdown || week?.softScore?.items || [];
  return `<p class="score-hero"><strong>${score}/100</strong></p>
    <p>The score reflects the existing preference and fairness scoring rules. Hard-rule validity is shown separately.</p>
    ${contextual?.categories?.length ? `<ul>${contextual.categories.map((item) => `<li>${escapeHtml(item.label)}: ${item.achieved} of ${item.available} points</li>`).join('')}</ul>` : (breakdown.length ? `<ul>${breakdown.slice(0, 12).map((item) => `<li>${escapeHtml(item.label || item.message || item.ruleId || String(item))}</li>`).join('')}</ul>` : '<p>No further score breakdown is available for this generated week.</p>')}`;
}

function compromisePanel(state) {
  const issues = collectIssues(state).filter((item) => item.severity === 'warning');
  return issues.length
    ? `<div class="context-issue-list">${issues.map((item) => `<button type="button" class="context-issue warning" data-navigate-issue="${escapeHtml(item.id)}"><strong>${escapeHtml(item.weekLabel)} · ${escapeHtml(item.day || 'Week')}</strong><span>${escapeHtml(item.message)}</span></button>`).join('')}</div>`
    : '<p>No current compromises are recorded.</p>';
}

export function renderContextPanel(state) {
  if (typeof document === 'undefined') return;
  const ui = ensureCoordinatedUiState(state);
  const shell = document.getElementById('contextPanel');
  if (!shell) return;
  if (!ui.activePanel) {
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    return;
  }
  const type = ui.activePanel;
  const context = ui.activePanelContext || {};
  let body = '<p>Details are not available.</p>';
  if (type === 'issues') body = issuePanel(state);
  if (type === 'score') body = scorePanel(state);
  if (type === 'compromise') body = compromisePanel(state);
  if (type === 'assignment') body = assignmentExplanation(state, context);
  if (type === 'save') body = `<p><strong>${escapeHtml(saveLabel(ui.saveState))}</strong></p><p>${escapeHtml(ui.saveDetail || 'Rota data is stored in this browser.')}</p>`;
  shell.innerHTML = `<div class="context-panel-scrim" data-context-close></div>
    <aside class="context-panel-card" role="dialog" aria-modal="false" aria-labelledby="contextPanelTitle">
      <header><div><span class="panel-eyebrow">Rota context</span><h2 id="contextPanelTitle">${escapeHtml(panelTitle(type))}</h2></div>
      <button type="button" class="icon-button secondary" data-context-close aria-label="Close contextual panel">×</button></header>
      <div class="context-panel-body">${body}</div>
    </aside>`;
  shell.classList.add('open');
  shell.setAttribute('aria-hidden', 'false');
  shell.querySelector('[data-context-close]')?.focus({ preventScroll: true });
}

export function collectIssues(state) {
  const weeks = state.generatedRotas.latestResult?.weeks || [];
  const issues = [];
  weeks.forEach((week, weekIndex) => {
    const weekLabel = `Week ${weekIndex + 1}`;
    (week.hardValidation || []).filter((item) => item.passed === false).forEach((item, index) => {
      const day = week.rota?.find((entry) => entry.date === item.date);
      issues.push({
        id: `hard-${weekIndex}-${item.ruleId || index}-${item.date || 'week'}-${item.section || 'general'}`,
        severity: 'error', weekIndex, weekLabel, date: item.date || '',
        day: day?.dayName || '', section: item.section || '', chef: item.chefName || '',
        message: String(item.message || 'Hard rule could not be satisfied.').replace(/^\[[^\]]+\]\s*/, '')
      });
    });
    (week.diagnostics || []).filter((item) => ['compromise', 'fairness'].includes(item.type)).forEach((item, index) => {
      const day = week.rota?.find((entry) => entry.date === item.date);
      const chef = state.staff.find((entry) => entry.id === item.chefId)?.name || '';
      issues.push({
        id: `warn-${weekIndex}-${item.code || index}-${item.date || 'week'}-${item.section || 'general'}`,
        severity: 'warning', weekIndex, weekLabel, date: item.date || '',
        day: day?.dayName || '', section: item.section || '', chef, message: item.message || 'Scheduling compromise.'
      });
    });
  });
  return issues.sort((a, b) => (
    (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)
    || a.weekIndex - b.weekIndex
    || a.date.localeCompare(b.date)
    || a.section.localeCompare(b.section)
  ));
}

export function navigateIssue(state, directionOrId) {
  const issues = collectIssues(state);
  if (!issues.length) return null;
  const ui = ensureCoordinatedUiState(state);
  let index;
  if (typeof directionOrId === 'string' && !['next', 'previous'].includes(directionOrId)) {
    index = issues.findIndex((item) => item.id === directionOrId);
  } else {
    const current = Math.max(-1, issues.findIndex((item) => item.id === ui.issueNavigationState.issueId));
    index = directionOrId === 'previous'
      ? (current <= 0 ? issues.length - 1 : current - 1)
      : (current + 1) % issues.length;
  }
  if (index < 0) index = 0;
  const issue = issues[index];
  ui.issueNavigationState = { index, issueId: issue.id };
  ui.selectedResultWeekIndex = issue.weekIndex;
  return issue;
}

export function emphasizeIssueCell(issue) {
  if (typeof document === 'undefined' || !issue) return;
  document.querySelectorAll('.issue-nav-emphasis').forEach((element) => element.classList.remove('issue-nav-emphasis'));
  const selector = issue.date
    ? `[data-week-index="${issue.weekIndex}"][data-date="${issue.date}"]${issue.section ? `[data-section="${CSS.escape(issue.section)}"]` : ''}`
    : `[data-week-panel="${issue.weekIndex}"]`;
  const target = document.querySelector(selector)
    || document.querySelector(`[data-week-index="${issue.weekIndex}"][data-date="${issue.date}"]`)
    || document.querySelector(`[data-week-panel="${issue.weekIndex}"]`);
  target?.classList.add('issue-nav-emphasis');
  target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  window.setTimeout(() => target?.classList.remove('issue-nav-emphasis'), 1800);
}

export function setDensity(state, density) {
  const ui = ensureCoordinatedUiState(state);
  ui.viewDensity = ['comfortable', 'compact'].includes(density) ? density : 'comfortable';
  persistUiPreferences(state);
  updateDocumentUiState(state);
}

export function toggleFullScreen(state, force) {
  const ui = ensureCoordinatedUiState(state);
  ui.fullScreenState = typeof force === 'boolean' ? force : !ui.fullScreenState;
  updateDocumentUiState(state);
  return ui.fullScreenState;
}

export function resetView(state) {
  const ui = ensureCoordinatedUiState(state);
  ui.activePanel = null;
  ui.activePanelContext = null;
  ui.selectedCell = null;
  ui.manualEditState = null;
  ui.issueNavigationState = { index: -1, issueId: '' };
  ui.comparisonState = { ...DEFAULT_UI.comparisonState };
  ui.fullScreenState = false;
  ui.expandedSections.legend = false;
  state.uiState.editMode = false;
  document.dispatchEvent(new CustomEvent('rota:reset-view'));
  renderContextPanel(state);
  persistUiPreferences(state);
  updateDocumentUiState(state);
}

export function updateDocumentUiState(state) {
  if (typeof document === 'undefined') return;
  const ui = ensureCoordinatedUiState(state);
  document.body.dataset.rotaDensity = ui.viewDensity;
  document.body.classList.toggle('rota-full-screen', !!ui.fullScreenState);
  document.body.classList.toggle('context-panel-open', !!ui.activePanel);
}

export function saveLabel(value) {
  return {
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    failed: 'Save failed'
  }[value] || 'Saved';
}

export function showToast(message, tone = 'success', action = '') {
  if (typeof document === 'undefined') return;
  const region = document.getElementById('toastRegion');
  if (!region) return;
  const existing = region.querySelector(`[data-toast-message="${CSS.escape(message)}"]`);
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `app-toast ${tone}`;
  toast.dataset.toastMessage = message;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button" class="secondary" data-toast-action="${escapeHtml(action)}">${escapeHtml(action)}</button>` : ''}<button type="button" class="toast-dismiss" data-toast-dismiss aria-label="Dismiss notification">×</button>`;
  region.replaceChildren(toast);
  window.setTimeout(() => toast.remove(), tone === 'error' ? 7000 : 3500);
}

export function comparisonFindings(state, weekAIndex, weekBIndex) {
  const weeks = state.generatedRotas.latestResult?.weeks || [];
  const a = weeks[weekAIndex];
  const b = weeks[weekBIndex];
  if (!a || !b || a === b) return [];
  const findings = [];
  const assignment = (week, dayName, section) => week.rota?.find((day) => day.dayName === dayName)?.assignments?.filter((item) => item.section === section).map((item) => item.chef) || [];
  state.staff.forEach((chef) => {
    const weekendA = ['Saturday', 'Sunday'].every((day) => a.rota.some((entry) => entry.dayName === day && entry.assignments.some((item) => item.chef === chef.name)));
    const weekendB = ['Saturday', 'Sunday'].every((day) => b.rota.some((entry) => entry.dayName === day && entry.assignments.some((item) => item.chef === chef.name)));
    if (weekendA && weekendB) findings.push({ type: 'weekend', chef: chef.name, message: `${chef.name} works Saturday and Sunday in both weeks.` });
    ['Breakfast', 'Float', 'Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'].forEach((section) => {
      const countA = a.rota.filter((day) => assignment(a, day.dayName, section).includes(chef.name)).length;
      const countB = b.rota.filter((day) => assignment(b, day.dayName, section).includes(chef.name)).length;
      if (countA && countB && (['Breakfast', 'Float'].includes(section) || countA + countB >= 3)) {
        findings.push({ type: section.toLowerCase(), chef: chef.name, section, message: `${chef.name} repeats ${section} across both weeks.` });
      }
    });
  });
  return findings.slice(0, 20);
}
