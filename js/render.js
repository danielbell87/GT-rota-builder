import { CHEF_ROLES, CORE_SECTIONS, DISPLAY_SECTIONS, EDITABLE_SKILL_SECTIONS, TARGET_HOURS } from './constants.js';
import { getState } from './state.js';
import {
  formatDate,
  formatWeekCommencing,
  parseLocalDate,
  formatCompactWeekRange,
  getPlanningHorizon,
  formatPlanningHorizonLabel,
  getWeekStartAtOffset
} from './utils.js';
import { scoreSoftPreferences } from './scoring.js';
import { buildRota, buildMultiWeekRota } from './solver.js';
import { getChefSoftPreferenceDetails } from './staff.js';
import { validateRotaHardRules, validateRotaSoftRules, getStaffConfigurationWarnings } from './validation.js?v=20260718h';
import { collectWeeklyInputsFromDom } from './weekly-inputs.js';

function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`GT Rota Builder is missing required element #${id}`);
  return element;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasFairnessActivity(entry) {
  return entry.weightedBurden > 0
    || entry.fridayCount > 0
    || entry.saturdayCount > 0
    || entry.sundayCount > 0;
}

function getEligibleMioChefs(state) {
  return state.staff.filter((staff) => staff.mioEligible);
}

// Treat a full-shift-equivalent gap from the 48-hour target as a notable outlier for the compact summary.
const HOURS_DEVIATION_THRESHOLD = 12;

function stripRuleIdPrefix(message = '') {
  return String(message).replace(/^[A-Z]\d{3}:\s*/, '');
}

function getWeekEnd(weekStart) {
  const end = parseLocalDate(weekStart);
  end.setDate(end.getDate() + 6);
  return end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatWeekIssueLabel(week) {
  return `Week ${week.weekNumber} · ${formatCompactWeekRange(week.weekStart)}`;
}

function renderStatusBadge(tone, text) {
  return `<span class="status-badge status-${tone}">${escapeHtml(text)}</span>`;
}

function getExpectedLeaveHoursForChef(chefName, inputs, weekStart) {
  const weekStartDate = parseLocalDate(weekStart);
  const weekEndDate = parseLocalDate(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const leaveDates = new Set();
  (inputs.availability || []).forEach((entry) => {
    if (entry.chef !== chefName || entry.type !== 'Annual Leave') return;
    const startDate = parseLocalDate(entry.startDate || entry.date);
    const finishDate = parseLocalDate(entry.finishDate || entry.date);
    for (let current = new Date(startDate); current <= finishDate; current.setDate(current.getDate() + 1)) {
      if (current < weekStartDate || current > weekEndDate) continue;
      leaveDates.add(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`);
    }
  });
  return Math.min(leaveDates.size, 4) * 12;
}

export function getWeekValidationView(week, state) {
  const inputs = week.inputs || {};
  const hasRota = Array.isArray(week.rota) && week.rota.length > 0;
  const hardValidation = Array.isArray(week.hardValidation)
    ? week.hardValidation
    : (hasRota ? validateRotaHardRules({ rota: week.rota, state, inputs, summary: week.summary || [], fullWeekDates: week.fullWeekDates }) : []);
  const softValidation = Array.isArray(week.softValidation)
    ? week.softValidation
    : (hasRota ? validateRotaSoftRules({ rota: week.rota, state, inputs }) : []);
  const softScore = week.softScore || (hasRota
    ? scoreSoftPreferences({ state, rota: week.rota, hardValidation })
    : { valid: false, score: 0, capped: false, explanation: [] });
  const hardFailures = hardValidation.filter((result) => result.severity === 'hard' && result.passed === false);
  const softFailures = softValidation.filter((result) => result.severity === 'soft' && result.passed === false);
  const generationFailures = (week.validation || []).map((result, index) => ({
    ruleId: result.ruleId || `GEN-${result.day || 'Overall'}-${index + 1}`,
    passed: false,
    severity: 'hard',
    day: result.day || 'Overall',
    message: result.message || 'Unknown validation failure.'
  }));
  const visibleHardFailures = week.status === 'infeasible' ? generationFailures : hardFailures;
  return {
    week,
    inputs,
    hardValidation,
    softValidation,
    hardFailures,
    softFailures,
    visibleHardFailures,
    generationFailures,
    softScore,
    valid: week.status === 'ok' && hardFailures.length === 0
  };
}

function renderResultsHeader(numberOfWeeks, weekStart) {
  const heading = numberOfWeeks === 1 ? 'Results' : `${numberOfWeeks}-week rota`;
  const range = numberOfWeeks === 1
    ? `${formatWeekCommencing(weekStart)} – ${getWeekEnd(weekStart)}`
    : formatPlanningHorizonLabel(weekStart, numberOfWeeks);
  return `
    <div class="results-header">
      <div>
        <h3 class="results-title">${escapeHtml(heading)}</h3>
        <p class="results-subtitle">${escapeHtml(range)}</p>
      </div>
    </div>`;
}

function renderOverallStatusCard(overallResult, weekViews) {
  if (overallResult.numberOfWeeks === 1) {
    const [view] = weekViews;
    if (view.valid) {
      return `
        <section class="status-card status-card-success" aria-label="Rota status">
          <div class="status-card-head">${renderStatusBadge('success', 'Valid')}</div>
          <h4>✓ Rota valid</h4>
          <p>No hard-rule problems found.</p>
        </section>`;
    }
    return `
      <section class="status-card status-card-danger" aria-label="Rota status">
        <div class="status-card-head">${renderStatusBadge('danger', 'Needs attention')}</div>
        <h4>${view.week.status === 'infeasible' ? 'Rota could not be generated' : 'Rota needs attention'}</h4>
        <p>${view.week.status === 'infeasible'
          ? 'The current staffing inputs conflict with required rules.'
          : `${view.visibleHardFailures.length} hard-rule failure${view.visibleHardFailures.length === 1 ? '' : 's'} found.`}</p>
      </section>`;
  }

  const validWeeks = weekViews.filter((view) => view.valid).length;
  const attentionWeeks = weekViews.length - validWeeks;
  const allValid = attentionWeeks === 0 && overallResult.status === 'ok';
  return `
    <section class="status-card ${allValid ? 'status-card-success' : 'status-card-warning'}" aria-label="Multi-week rota status">
      <div class="status-card-head">${renderStatusBadge(allValid ? 'success' : 'warning', allValid ? 'All weeks valid' : 'Week issues found')}</div>
      <h4>${escapeHtml(`${overallResult.numberOfWeeks}-week rota`)}</h4>
      <p>${allValid
        ? 'All weeks passed hard-rule validation.'
        : `${validWeeks} week${validWeeks === 1 ? '' : 's'} valid · ${attentionWeeks} week${attentionWeeks === 1 ? '' : 's'} require${attentionWeeks === 1 ? 's' : ''} attention.`}</p>
    </section>`;
}

function renderWeekChecksOverview(weekViews) {
  if (weekViews.length <= 1) return '';
  return `
    <section class="results-section">
      <h4>Rota checks</h4>
      <div class="week-checks">
        ${weekViews.map((view) => `
          <article class="week-check ${view.valid ? 'week-check-success' : 'week-check-warning'}">
            <div class="week-check-title">${escapeHtml(formatWeekIssueLabel(view.week))}</div>
            <div class="week-check-summary">${view.valid ? '✓ No problems found' : `${view.visibleHardFailures.length} issue${view.visibleHardFailures.length === 1 ? '' : 's'}`}</div>
            ${view.valid ? '' : `<ul class="issue-list compact">${view.visibleHardFailures.map((failure) => `<li>${escapeHtml(stripRuleIdPrefix(failure.message))}</li>`).join('')}</ul>`}
          </article>`).join('')}
      </div>
    </section>`;
}

function renderWeekStatusCard(view) {
  if (view.valid) {
    return `
      <section class="status-card status-card-success" aria-label="Week status">
        <div class="status-card-head">${renderStatusBadge('success', 'Valid')}</div>
        <h4>✓ Rota valid</h4>
        <p>No hard-rule problems found.</p>
      </section>`;
  }

  if (view.week.status === 'infeasible') {
    return `
      <section class="status-card status-card-danger" aria-label="Week status">
        <div class="status-card-head">${renderStatusBadge('danger', 'Infeasible')}</div>
        <h4>Rota could not be generated</h4>
        <p>The current staffing inputs conflict with required rules.</p>
      </section>`;
  }

  return `
    <section class="status-card status-card-danger" aria-label="Week status">
      <div class="status-card-head">${renderStatusBadge('danger', 'Needs attention')}</div>
      <h4>Rota needs attention</h4>
      <p>${view.visibleHardFailures.length} hard-rule failure${view.visibleHardFailures.length === 1 ? '' : 's'} found.</p>
    </section>`;
}

function getChefRowProblems(item, view) {
  const totalHours = item.totalCreditedHours ?? item.hours ?? 0;
  const expectedLeaveHours = getExpectedLeaveHoursForChef(item.name, view.inputs, view.week.weekStart);
  const isSelectedMioChef = item.name === view.inputs.mioChef;
  const adjustedGtTarget = item.adjustedGtTarget ?? (isSelectedMioChef ? 2 : 4);
  const hasHoursProblem = totalHours > (TARGET_HOURS.weekly + HOURS_DEVIATION_THRESHOLD)
    || (totalHours > 0 && totalHours < (TARGET_HOURS.weekly - HOURS_DEVIATION_THRESHOLD));
  return {
    gt: item.gtDays !== adjustedGtTarget,
    mio: isSelectedMioChef && (item.mioDays !== 3 || item.gtDays !== 2),
    leave: expectedLeaveHours !== (item.annualLeaveHours || 0),
    hours: hasHoursProblem
  };
}

function renderChefHoursSummary(view) {
  if (!view.week.summary?.length) return '';
  const rows = view.week.summary.map((item) => {
    const totalHours = item.totalCreditedHours ?? item.hours ?? 0;
    const problems = getChefRowProblems(item, view);
    const hasProblem = Object.values(problems).some(Boolean);
    const adjustedGtTarget = item.adjustedGtTarget ?? (item.name === view.inputs.mioChef ? 2 : 4);
    return `
      <tr class="${hasProblem ? 'summary-row-problem' : ''}">
        <th scope="row">${escapeHtml(item.name)}</th>
        <td${problems.gt ? ' class="metric-problem"' : ''}>${item.gtDays}/${adjustedGtTarget}</td>
        <td${problems.mio ? ' class="metric-problem"' : ''}>${item.mioDays}</td>
        <td${problems.leave ? ' class="metric-problem"' : ''}>${item.annualLeaveHours.toFixed(1)}h</td>
        <td${problems.hours ? ' class="metric-problem"' : ''}>${totalHours.toFixed(1)}h</td>
      </tr>`;
  }).join('');

  return `
    <section class="results-section">
      <h4>Chef-hours summary</h4>
      <table class="summary-table chef-hours-table">
        <thead>
          <tr><th>Chef</th><th>GT days</th><th>MIO days</th><th>Leave credit</th><th>Total credited hours</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderHardFailureSection(view) {
  if (!view.visibleHardFailures.length) return '';
  return `
    <section class="results-section">
      <h4>${view.week.status === 'infeasible' ? 'Failure reasons' : 'Failed hard rules'}</h4>
      <p class="section-note">${view.week.status === 'infeasible'
        ? 'Specific issues found while generating this rota.'
        : `${view.visibleHardFailures.length} hard-rule failure${view.visibleHardFailures.length === 1 ? '' : 's'} found.`}</p>
      <ul class="issue-list hard-failure-list">
        ${view.visibleHardFailures.map((failure) => `<li>${escapeHtml(stripRuleIdPrefix(failure.message))}</li>`).join('')}
      </ul>
    </section>`;
}

function renderSoftCompromiseSection(view) {
  if (!view.softFailures.length) return '';
  return `
    <section class="results-section">
      <h4>Scheduling compromises</h4>
      <p class="section-note">${view.softFailures.length} preference${view.softFailures.length === 1 ? '' : 's'} could not be met.</p>
      <ul class="issue-list soft-failure-list">
        ${view.softFailures.map((failure) => `<li>${escapeHtml(stripRuleIdPrefix(failure.message))}</li>`).join('')}
      </ul>
    </section>`;
}

function renderTechnicalDetails(view) {
  const optimization = view.week.optimizationDiagnostics;
  const hardRows = view.hardValidation.map((result) => `
    <tr>
      <td>${escapeHtml(result.ruleId)}</td>
      <td>${escapeHtml(result.severity)}</td>
      <td>${result.passed ? 'Passed' : 'Failed'}</td>
      <td>${escapeHtml(result.message)}</td>
    </tr>`).join('');
  const softRows = view.softValidation.map((result) => `
    <tr>
      <td>${escapeHtml(result.ruleId)}</td>
      <td>${escapeHtml(result.severity)}</td>
      <td>${result.passed ? 'Passed' : 'Failed'}</td>
      <td>${escapeHtml(result.message)}</td>
    </tr>`).join('');
  const generatorRows = view.week.validation?.length
    ? view.week.validation.map((result, index) => `
      <tr>
        <td>${escapeHtml(result.ruleId || `GEN${String(index + 1).padStart(3, '0')}`)}</td>
        <td>${escapeHtml(result.day || 'Overall')}</td>
        <td>${escapeHtml(result.severity || 'bad')}</td>
        <td>${escapeHtml(result.message || '')}</td>
      </tr>`).join('')
    : '';

  return `
    <details class="technical-details print-hidden">
      <summary>View technical details</summary>
      <div class="technical-block">
        <h5>Weekly MIO configuration</h5>
        <p class="small">MIO chef: ${escapeHtml(view.inputs.mioChef || 'None')}</p>
      </div>
      ${optimization ? `
        <div class="technical-block">
          <h5>Whole-rota optimisation</h5>
          <p class="small">Priority: hard constraints → Preferred Days Off → weekend fairness → other soft preferences.</p>
          <table class="summary-table optimization-diagnostics-table">
            <tbody>
              <tr><th>Initial soft score</th><td>${optimization.initialSoftScore.toFixed(1)}</td></tr>
              <tr><th>Final soft score</th><td>${optimization.finalSoftScore.toFixed(1)}</td></tr>
              <tr><th>Preferred-day-off violations</th><td>${optimization.initialPreferredDayOffViolationCount ?? 0} → ${optimization.finalPreferredDayOffViolationCount ?? 0}</td></tr>
              <tr><th>Weekend-fairness penalty</th><td>${(optimization.initialWeekendFairnessPenalty ?? 0).toFixed(1)} → ${(optimization.finalWeekendFairnessPenalty ?? 0).toFixed(1)}</td></tr>
              <tr><th>Candidate rotas evaluated</th><td>${optimization.candidateRotasEvaluated}</td></tr>
              <tr><th>Accepted optimisation moves</th><td>${optimization.acceptedOptimizationMoves}</td></tr>
              <tr><th>Improved from initial valid rota</th><td>${optimization.improvedFromInitial ? 'Yes' : 'No'}</td></tr>
              <tr><th>Search limits</th><td>${optimization.limits.initialCandidateCount} initial candidates · ${optimization.limits.maxOptimizationIterations} iterations · ${optimization.limits.maxNeighborEvaluationsPerIteration} neighbours per iteration</td></tr>
            </tbody>
          </table>
        </div>` : ''}
      ${generatorRows ? `
        <div class="technical-block">
          <h5>Generation diagnostics</h5>
          <table class="summary-table technical-table">
            <thead><tr><th>Rule ID</th><th>Scope</th><th>Severity</th><th>Message</th></tr></thead>
            <tbody>${generatorRows}</tbody>
          </table>
        </div>` : ''}
      <div class="technical-block">
        <h5>Full hard validation</h5>
        <table class="summary-table technical-table">
          <thead><tr><th>Rule ID</th><th>Severity</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>${hardRows || '<tr><td colspan="4">No hard validation data available.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="technical-block">
        <h5>Full soft validation</h5>
        <table class="summary-table technical-table">
          <thead><tr><th>Rule ID</th><th>Severity</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>${softRows || '<tr><td colspan="4">No soft validation data available.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="technical-block">
        <h5>Scoring diagnostics</h5>
        <div class="small">Soft score: ${view.softScore.score.toFixed(1)}${view.softScore.capped ? ' (capped due to hard-rule failure)' : ''}</div>
        <div class="small">${view.softScore.explanation?.length ? view.softScore.explanation.map((line) => `• ${escapeHtml(line)}`).join('<br>') : '• No soft-rule trade-offs detected.'}</div>
      </div>
    </details>`;
}

function getSuggestedMioRotation(eligibleChefs) {
  return eligibleChefs.map((chef) => chef.name);
}

function renderMioOptions(selectedChefName, eligibleChefs, state) {
  const eligibleNames = new Set(eligibleChefs.map((chef) => chef.name));
  const selectedStaff = selectedChefName ? state.staff.find((chef) => chef.name === selectedChefName) : null;
  const invalidSelectedOption = selectedChefName && !eligibleNames.has(selectedChefName)
    ? `<option value="${escapeHtml(selectedChefName)}" selected>${escapeHtml(selectedStaff ? `${selectedChefName} (not eligible)` : `${selectedChefName} (not in staff list)`)}</option>`
    : '';
  return [
    `<option value="" ${selectedChefName ? '' : 'selected'}>No MIO chef</option>`,
    invalidSelectedOption,
    ...eligibleChefs.map((chef) => `<option value="${escapeHtml(chef.name)}" ${selectedChefName === chef.name ? 'selected' : ''}>${escapeHtml(chef.name)}</option>`)
  ].join('');
}

function ensureWeeklyMioSelections() {
  const state = getState();
  const weekStart = state.weeklyInputs.weekStart;
  const numWeeks = state.weeklyInputs.numWeeks || 1;
  const eligible = getEligibleMioChefs(state);
  const rotation = getSuggestedMioRotation(eligible);
  const selections = state.weeklyInputs.weeklyMioSelections && typeof state.weeklyInputs.weeklyMioSelections === 'object'
    ? state.weeklyInputs.weeklyMioSelections
    : {};

  state.weeklyInputs.weeklyMioSelections = selections;

  const activeWeekStarts = Array.from({ length: numWeeks }, (_, index) => getWeekStartAtOffset(weekStart, index));
  const activeWeekStartSet = new Set(activeWeekStarts);
  Object.keys(selections).forEach((savedWeekStart) => {
    if (!activeWeekStartSet.has(savedWeekStart)) delete selections[savedWeekStart];
  });

  for (let weekIndex = 0; weekIndex < numWeeks; weekIndex += 1) {
    const currentWeekStart = activeWeekStarts[weekIndex];
    const hasSavedSelection = Object.prototype.hasOwnProperty.call(selections, currentWeekStart);
    const existing = hasSavedSelection
      ? (typeof selections[currentWeekStart] === 'string' ? selections[currentWeekStart] : '')
      : (weekIndex === 0 && typeof state.weeklyInputs.mioChef === 'string' ? state.weeklyInputs.mioChef : null);
    if (existing === '' || (typeof existing === 'string' && existing.length > 0)) {
      selections[currentWeekStart] = existing;
      continue;
    }
    selections[currentWeekStart] = rotation[weekIndex % Math.max(rotation.length, 1)] || eligible[0]?.name || '';
  }

  const firstWeekSelection = Object.prototype.hasOwnProperty.call(selections, weekStart) ? selections[weekStart] : '';
  state.weeklyInputs.mioChef = firstWeekSelection;
  if (weekStart) selections[weekStart] = firstWeekSelection;

  return Array.from({ length: numWeeks }, (_, index) => {
    const currentWeekStart = getWeekStartAtOffset(weekStart, index);
    return {
      weekIndex: index,
      weekStart: currentWeekStart,
      chefName: selections[currentWeekStart] || '',
      label: formatCompactWeekRange(currentWeekStart)
    };
  });
}

function renderPlanningHorizonSummary() {
  const state = getState();
  const horizonLabel = document.getElementById('planningHorizonLabel');
  if (!horizonLabel) return;
  horizonLabel.textContent = `Planning horizon: ${formatPlanningHorizonLabel(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks)} (${state.weeklyInputs.numWeeks} week${state.weeklyInputs.numWeeks === 1 ? '' : 's'})`;
}

function setCheckboxGroupValues(selector, values = []) {
  const selected = new Set(values);
  document.querySelectorAll(selector).forEach((input) => {
    const optionValue = input.dataset.preferredDayOff || input.dataset.preferredSection || input.value;
    input.checked = selected.has(optionValue);
    input.closest('.choice-chip')?.classList.toggle('selected', input.checked);
  });
}

function syncChoiceChipState(input) {
  input.closest('.choice-chip')?.classList.toggle('selected', !!input.checked);
}

export function syncChefChoiceChipState(input) {
  syncChoiceChipState(input);
}

function getStaffForDisplay() {
  const state = getState();
  return state.staff.map((chef, index) => ({ chef, index }));
}

function getChefBadges(chef) {
  const preferenceDetails = getChefSoftPreferenceDetails(chef);
  return [
    chef.senior === true ? {
      key: 'senior',
      label: 'Senior',
      accessibleLabel: 'Senior chef'
    } : null,
    chef.mioEligible === true ? {
      key: 'mio',
      label: 'MIO',
      accessibleLabel: 'MIO eligible'
    } : null,
    chef.breakfastEligible === true ? {
      key: 'breakfast',
      label: 'Breakfast',
      accessibleLabel: 'Breakfast eligible'
    } : null,
    preferenceDetails.count > 0 ? {
      key: 'preferences',
      label: `Preferences · ${preferenceDetails.count}`,
      accessibleLabel: `${preferenceDetails.count} active soft preference${preferenceDetails.count === 1 ? '' : 's'}`,
      title: preferenceDetails.summary
    } : null
  ].filter(Boolean);
}

function renderChefBadge(badge) {
  const title = badge.title ? ` title="${escapeHtml(badge.title)}"` : '';
  const ariaLabel = getChefBadgeAccessibleText(badge);
  return `<span class="chef-list-badge chef-list-badge-${badge.key}" aria-label="${escapeHtml(ariaLabel)}"${title}>${escapeHtml(badge.label)}</span>`;
}

function getChefBadgeAccessibleText(badge) {
  return badge.title
    ? `${badge.accessibleLabel}. ${badge.title}`
    : badge.accessibleLabel;
}

export function openChefModal() {
  const modal = getRequiredElement('chefModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeChefModal() {
  const modal = getRequiredElement('chefModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

export function clearChefModalError() {
  const errorEl = getRequiredElement('chefFormError');
  errorEl.textContent = '';
  document.querySelectorAll('#chefForm [aria-invalid="true"]').forEach((field) => {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  });
}

export function showChefModalError(message, fieldId = '') {
  clearChefModalError();
  const errorEl = getRequiredElement('chefFormError');
  errorEl.textContent = message || '';
  if (!fieldId) return;
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', 'chefFormError');
}

export function setChefRemovalConfirmation(open, chefName = '') {
  const confirmation = getRequiredElement('chefRemoveConfirmation');
  const confirmText = getRequiredElement('chefRemoveConfirmationText');
  const confirmButton = getRequiredElement('confirmRemoveChefBtn');
  confirmText.textContent = `Remove ${chefName || 'this chef'} from the staff list? Existing rota and history references may be affected, but published history snapshots will be kept where possible.`;
  confirmButton.textContent = chefName ? `Remove ${chefName}` : 'Remove chef';
  confirmation.classList.toggle('hidden', !open);
}

export function populateChefModal({ chef, mode = 'create', showRemove = false }) {
  const modalTitle = getRequiredElement('chefModalTitle');
  const modalSubtitle = getRequiredElement('chefModalSubtitle');
  const roleSelect = getRequiredElement('chefRoleInput');
  const saveButton = getRequiredElement('saveChefBtn');
  const removeSection = getRequiredElement('chefDangerZone');
  const advancedSection = getRequiredElement('chefAdvancedSection');

  roleSelect.innerHTML = ['<option value="">Select role</option>', ...CHEF_ROLES.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`)].join('');
  modalTitle.textContent = mode === 'create' ? 'Add chef' : 'Edit chef';
  modalSubtitle.textContent = mode === 'create' ? 'Create a new staff profile' : `${chef.name} · ${chef.role || 'Role not set'}`;
  saveButton.textContent = mode === 'create' ? 'Add chef' : 'Save changes';

  getRequiredElement('chefNameInput').value = chef.name || '';
  roleSelect.value = chef.role || '';
  getRequiredElement('chefSeniorInput').checked = chef.senior === true;
  getRequiredElement('chefMioEligibleInput').checked = !!chef.mioEligible;
  getRequiredElement('chefBreakfastEligibleInput').checked = chef.breakfastEligible !== false;
  getRequiredElement('chefPreferredBreakfastInput').value = chef.preferredBreakfast || '';
  getRequiredElement('chefNotesInput').value = chef.notes || '';
  EDITABLE_SKILL_SECTIONS.forEach((section) => {
    const field = document.getElementById(`chefSkill${section}Input`);
    if (field) field.value = String(chef.skills?.[section] ?? 0);
  });
  setCheckboxGroupValues('input[data-preferred-day-off]', chef.preferredDaysOff || []);
  removeSection.classList.toggle('hidden', !showRemove);
  advancedSection.open = false;
  setChefRemovalConfirmation(false, chef.name || '');
  clearChefModalError();
}

export function readChefDraftFromModal() {
  return {
    name: getRequiredElement('chefNameInput').value.trim(),
    role: getRequiredElement('chefRoleInput').value,
    senior: getRequiredElement('chefSeniorInput').checked,
    mioEligible: getRequiredElement('chefMioEligibleInput').checked,
    breakfastEligible: getRequiredElement('chefBreakfastEligibleInput').checked,
    preferredBreakfast: getRequiredElement('chefPreferredBreakfastInput').value,
    preferredDaysOff: [...document.querySelectorAll('input[data-preferred-day-off]:checked')].map((input) => input.dataset.preferredDayOff),
    notes: getRequiredElement('chefNotesInput').value,
    skills: Object.fromEntries(EDITABLE_SKILL_SECTIONS.map((section) => [
      section,
      Number.parseInt(document.getElementById(`chefSkill${section}Input`)?.value || '0', 10)
    ]))
  };
}

export function renderAdditionalChefRequirements() {
  const state = getState();
  const container = document.getElementById('additionalChefList');
  if (!container) return;

  const reqs = (state.weeklyInputs.additionalChefRequirements || []).slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!reqs.length) {
    container.innerHTML = '<p class="small chef-req-empty">No additional staffing requests in the selected planning horizon.</p>';
    return;
  }

  container.innerHTML = reqs.map((req) => {
    const date = parseLocalDate(req.date);
    const label = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const chefWord = req.count === 1 ? 'chef' : 'chefs';
    return `<div class="chef-req-row">
      <span class="chef-req-label">${label} — +${req.count} ${chefWord}</span>
      <button class="secondary small-btn" data-edit-req="${req.date}" aria-label="Edit additional chef request for ${label}">Edit</button>
      <button class="danger small-btn" data-remove-req="${req.date}" aria-label="Remove additional chef request for ${label}">Remove</button>
    </div>`;
  }).join('');
}

export function renderMioControls() {
  const state = getState();
  const singleControl = getRequiredElement('singleMioControl');
  const singleSelect = getRequiredElement('mioChef');
  const multiContainer = getRequiredElement('weeklyMioSelectors');
  const weeks = ensureWeeklyMioSelections();
  const eligible = getEligibleMioChefs(state);

  singleSelect.innerHTML = renderMioOptions(state.weeklyInputs.mioChef, eligible, state);

  if (state.weeklyInputs.numWeeks === 1) {
    singleControl.classList.remove('hidden');
    multiContainer.classList.add('hidden');
    multiContainer.innerHTML = '';
    if (singleSelect.value !== state.weeklyInputs.mioChef) singleSelect.value = state.weeklyInputs.mioChef;
    return;
  }

  singleControl.classList.add('hidden');
  multiContainer.classList.remove('hidden');
  multiContainer.innerHTML = `
    <div class="weekly-mio-header">
      <h3 id="weeklyMioHeading" class="mb-6">MIO chef by week</h3>
      <p class="small mb-12">Select No MIO chef for any week where the kitchen cannot spare someone for MIO duty.</p>
    </div>
    <div class="weekly-mio-table-wrap">
      <table class="weekly-mio-table">
        <thead><tr><th scope="col">Week</th><th scope="col">Week commencing</th><th scope="col">MIO chef</th></tr></thead>
        <tbody>
          ${weeks.map((week) => {
            const selectId = `mioChefWeek-${week.weekStart}`;
            return `<tr>
              <th scope="row" data-label="Week">Week ${week.weekIndex + 1}</th>
              <td data-label="Week commencing">${escapeHtml(formatWeekCommencing(week.weekStart))}</td>
              <td data-label="MIO chef">
                <label class="visually-hidden" for="${selectId}">MIO chef for week ${week.weekIndex + 1}, commencing ${escapeHtml(formatWeekCommencing(week.weekStart))}</label>
                <select id="${selectId}" data-weekly-mio-start="${week.weekStart}">${renderMioOptions(week.chefName, eligible, state)}</select>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export function renderStaffTable() {
  const state = getState();
  const container = getRequiredElement('staffList');
  const countLabel = getRequiredElement('staffCountLabel');
  const warnings = getStaffConfigurationWarnings(state.staff);
  countLabel.textContent = `· ${state.staff.length}`;

  if (!state.staff.length) {
    container.innerHTML = `
      <div class="chef-empty-state">
        <p class="small">No chefs have been added.</p>
        <button type="button" class="secondary" data-open-chef-create="true">Add chef</button>
      </div>`;
    renderMioControls();
    return;
  }

  container.innerHTML = `
    ${warnings.map((warning) => `<p class="section-note">${escapeHtml(warning.message)}</p>`).join('')}
    ${getStaffForDisplay().map(({ chef }) => {
    const badges = getChefBadges(chef);
    const badgeSummary = badges.map(getChefBadgeAccessibleText).join(', ');
    return `
      <button
        type="button"
        class="chef-list-row"
        data-open-chef-id="${escapeHtml(chef.id)}"
        aria-label="Edit ${escapeHtml(chef.name)}, ${escapeHtml(chef.role || 'role not set')}${badgeSummary ? `. ${escapeHtml(badgeSummary)}` : ''}"
      >
        <span class="chef-list-copy">
          <span class="chef-list-name">${escapeHtml(chef.name)}</span>
          <span class="chef-list-secondary">
            <span class="chef-list-role">${escapeHtml(chef.role || 'Role not set')}</span>
            ${badges.length ? `<span class="chef-list-badges">${badges.map(renderChefBadge).join('')}</span>` : ''}
          </span>
        </span>
        <span class="chef-list-action" aria-hidden="true">›</span>
      </button>`;
  }).join('')}`;
  renderMioControls();
}

export function renderAvailabilityTable() {
  const state = getState();
  const body = getRequiredElement('availabilityBody');
  const horizon = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks);
  const staffOptions = getStaffForDisplay().map(({ chef }) => chef);
  body.innerHTML = '';
  state.weeklyInputs.availability.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><select class="entry-chef" data-index="${index}">${staffOptions.map((staff) => `<option value="${escapeHtml(staff.name)}" ${entry.chef === staff.name ? 'selected' : ''}>${escapeHtml(staff.name)}</option>`).join('')}</select></td>
      <td><select class="entry-type" data-index="${index}"><option ${entry.type === 'Annual Leave' ? 'selected' : ''}>Annual Leave</option><option ${entry.type === 'Unavailable' ? 'selected' : ''}>Unavailable</option></select></td>
      <td><input class="entry-start-date" type="date" min="${horizon.start}" max="${horizon.end}" data-index="${index}" value="${entry.startDate || ''}"></td>
      <td><input class="entry-finish-date" type="date" min="${horizon.start}" max="${horizon.end}" data-index="${index}" value="${entry.finishDate || ''}"></td>
      <td><input class="entry-notes" type="text" data-index="${index}" value="${escapeHtml(entry.notes || '')}"></td>
      <td><button class="danger" data-remove="${index}">Remove</button></td>`;
    body.appendChild(row);
  });
}

function renderRotaTable(solveResult) {
  if (!solveResult.rota?.length) return '';
  const dayHeaders = solveResult.rota.map((day) => `<th scope="col">${day.dayName}<br><span class="small">${formatDate(day.date)}</span></th>`).join('');
  const sectionCells = DISPLAY_SECTIONS.map((section) => {
    const cells = solveResult.rota.map((day) => {
      if (section === 'Float') {
        const floatChefs = day.assignments.filter((assignment) => assignment.section === 'Float').map((assignment) => assignment.chef);
        return `<td>${floatChefs.length ? escapeHtml(floatChefs.join(', ')) : '—'}</td>`;
      }
      const matches = day.assignments.filter((assignment) => assignment.section === section);
      return `<td>${matches.length ? escapeHtml(matches.map((assignment) => assignment.chef).join(', ')) : '—'}</td>`;
    }).join('');
    return `<tr><th scope="row">${section}</th>${cells}</tr>`;
  }).join('');

  return `
    <section class="results-section">
      <h4>Rota table</h4>
      <p class="rota-swipe-guidance">Swipe left or right to view the full week.</p>
      <div class="rota-table-scroll" role="region" aria-label="Weekly rota table, horizontally scrollable on smaller screens">
        <table class="rota-table"><thead><tr><th scope="col">Section</th>${dayHeaders}</tr></thead><tbody>${sectionCells}</tbody></table>
      </div>
    </section>`;
}

export function updateRotaScrollAccessibility(root = document) {
  const mobileViewport = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 900px)').matches;
  root.querySelectorAll('.rota-table-scroll').forEach((wrapper) => {
    const genuinelyOverflows = mobileViewport
      && wrapper.clientWidth > 0
      && wrapper.scrollWidth > wrapper.clientWidth + 1;
    if (genuinelyOverflows) wrapper.setAttribute('tabindex', '0');
    else wrapper.removeAttribute('tabindex');
  });
}

function renderFairnessSummary(summary = []) {
  if (!summary.length) return '';
  const activeRows = summary.filter(hasFairnessActivity);
  if (!activeRows.length) return '';
  const weightedBurdenValues = activeRows.map((entry) => entry.weightedBurden);
  const spread = weightedBurdenValues.length > 1 ? Math.max(...weightedBurdenValues) - Math.min(...weightedBurdenValues) : 0;
  const rows = summary
    .filter(hasFairnessActivity)
    .map((entry) => {
      const latest = entry.latestWeekendBlock === 'sat-sun'
        ? 'Sat–Sun off, consecutive weekend block'
        : (entry.latestWeekendBlock === 'fri-sat'
          ? 'Fri–Sat off, consecutive weekend block'
          : 'No consecutive weekend block this rota');
      const priority = entry.duePriority ? ' · Next priority' : '';
      return `<tr><th scope="row">${escapeHtml(entry.name)}</th><td>${entry.fridayCount}</td><td>${entry.saturdayCount}</td><td>${entry.sundayCount}</td><td>${entry.friSatBlocksOff || 0}</td><td>${entry.satSunBlocksOff || 0}</td><td>${escapeHtml(latest + priority)}</td></tr>`;
    })
    .join('');
  return `
    <section class="results-section">
      <h4>Fairness summary</h4>
      <p class="section-note">Weekend fairness is applied only after Preferred Days Off have been satisfied as far as hard constraints allow.</p>
      <table class="summary-table fairness-table">
        <thead><tr><th>Chef</th><th>Friday duties</th><th>Saturday duties</th><th>Sunday duties</th><th>Fri–Sat off</th><th>Sat–Sun off</th><th>Current block status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${spread > 2 ? '<p class="section-note">Weekend coverage is meaningfully uneven across the selected weeks.</p>' : ''}
    </section>`;
}

export function renderWeekPanel(view, options = {}) {
  const fairnessHtml = options.fairnessHtml || '';
  const showHeader = options.showHeader !== false;
  const showStatus = options.showStatus !== false;
  return `
    <section class="week-panel ${options.hidden ? 'hidden' : ''}" data-week-panel="${view.week.weekIndex}">
      ${showHeader ? `<div class="week-panel-header">
        <h4 class="multi-week-heading">${escapeHtml(`Week ${view.week.weekNumber}`)}</h4>
        <p class="results-subtitle">${escapeHtml(`${formatWeekCommencing(view.week.weekStart)} – ${getWeekEnd(view.week.weekStart)}`)}</p>
      </div>` : ''}
      <p class="week-mio-summary"><strong>MIO chef:</strong> ${escapeHtml(view.inputs.mioChef || 'None')}</p>
      ${showStatus ? renderWeekStatusCard(view) : ''}
      ${view.week.status === 'infeasible' ? '' : renderRotaTable(view.week)}
      ${view.week.status === 'infeasible' ? '' : renderChefHoursSummary(view)}
      ${fairnessHtml}
      ${renderHardFailureSection(view)}
      ${renderSoftCompromiseSection(view)}
      ${renderTechnicalDetails(view)}
    </section>`;
}

export function renderResultsPanel() {
  const state = getState();
  const inputs = collectWeeklyInputsFromDom();
  const container = getRequiredElement('results');

  let overallResult;
  if ((inputs.numWeeks || 1) === 1) {
    const solveResult = buildRota(inputs);
    overallResult = {
      status: solveResult.status,
      numberOfWeeks: 1,
      weeks: [{ weekIndex: 0, weekNumber: 1, weekStart: inputs.weekStart, mioChef: inputs.mioChef, inputs, ...solveResult }],
      fairnessApplied: false,
      fairnessSummary: []
    };
  } else {
    overallResult = buildMultiWeekRota({
      ...inputs,
      weeklyMioSelections: { ...(state.weeklyInputs.weeklyMioSelections || {}) }
    });
  }

  const weeks = overallResult.weeks || [];
  state.generatedRotas.latestResult = overallResult;
  const printButton = document.getElementById('printRotaBtn');
  if (printButton) {
    printButton.disabled = !weeks.length || weeks.some((week) => week.status !== 'ok' || !week.rota?.length);
  }
  const activeWeekIndex = Math.max(0, Math.min(state.uiState.selectedResultWeekIndex || 0, Math.max(weeks.length - 1, 0)));
  state.uiState.selectedResultWeekIndex = activeWeekIndex;
  const weekViews = weeks.map((week) => getWeekValidationView(week, state));
  const activeView = weekViews[activeWeekIndex] || null;
  const firstOk = weeks.find((week) => week.status === 'ok');
  state.generatedRotas.current = activeView?.week?.status === 'ok' ? activeView.week : (firstOk || null);
  state.uiState.validation = activeView?.hardValidation || [];
  state.uiState.softValidation = activeView?.softValidation || [];
  state.uiState.validationByWeek = weekViews.map((view) => ({
    weekIndex: view.week.weekIndex,
    weekNumber: view.week.weekNumber,
    weekStart: view.week.weekStart,
    status: view.week.status,
    hardValidation: view.hardValidation,
    softValidation: view.softValidation,
    generationValidation: view.week.validation || [],
    hardFailures: view.hardFailures,
    softFailures: view.softFailures
  }));
  state.uiState.softScore = activeView?.softScore || null;

  if (overallResult.numberOfWeeks === 1) {
    container.innerHTML = `
      <div class="results-layout">
        ${renderResultsHeader(1, inputs.weekStart)}
        ${renderOverallStatusCard(overallResult, weekViews)}
        ${activeView ? renderWeekPanel(activeView, { showHeader: false, showStatus: false }) : ''}
      </div>`;
  } else {
    const tabs = weeks.map((week, index) => `<button class="week-tab ${index === activeWeekIndex ? 'active' : ''}" data-results-week-index="${index}">Week ${index + 1}</button>`).join('');
    const dropdownOptions = weeks.map((week, index) => `<option value="${index}" ${index === activeWeekIndex ? 'selected' : ''}>Week ${index + 1} · ${formatCompactWeekRange(week.weekStart)}</option>`).join('');
    const fairnessHtml = renderFairnessSummary(overallResult.fairnessSummary);
    const panels = weekViews.map((view, index) => renderWeekPanel(view, {
      hidden: index !== activeWeekIndex,
      fairnessHtml: index === activeWeekIndex ? fairnessHtml : ''
    })).join('');

    container.innerHTML = `
      <div class="results-layout">
        ${renderResultsHeader(overallResult.numberOfWeeks, inputs.weekStart)}
        ${renderOverallStatusCard(overallResult, weekViews)}
        ${renderWeekChecksOverview(weekViews)}
        <div class="desktop-only week-tabs print-hidden" role="tablist">${tabs}</div>
        <label class="mobile-only print-hidden">Week<select id="resultsWeekSelect">${dropdownOptions}</select></label>
        <div class="week-panels">${panels}</div>
      </div>`;
  }

  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      updateRotaScrollAccessibility(container);
      window.requestAnimationFrame(() => updateRotaScrollAccessibility(container));
    });
  }

  if (typeof window !== 'undefined') {
    window.__gtRotaBootstrap = {
      ...(window.__gtRotaBootstrap || {}),
      lastRender: {
        mode: overallResult.numberOfWeeks === 1 ? 'single' : 'multi',
        numberOfWeeks: overallResult.numberOfWeeks,
        overallStatus: overallResult.status,
        fairnessApplied: !!overallResult.fairnessApplied,
        visibleWeekCount: weeks.length,
        weekStarts: weeks.map((week) => week.weekStart),
        weekMioChefs: weeks.map((week) => week.mioChef),
        activeWeekIndex,
        activeWeekHardFailureCount: activeView?.visibleHardFailures?.length || 0,
        validationByWeek: state.uiState.validationByWeek,
        weekValidationSummary: weekViews.map((view) => ({
          weekIndex: view.week.weekIndex,
          status: view.week.status,
          hardFailures: view.visibleHardFailures.length,
          softFailures: view.softFailures.length,
          hardValidationCount: view.hardValidation.length,
          softValidationCount: view.softValidation.length
        }))
      }
    };
  }
}

export function renderAll() {
  renderPlanningHorizonSummary();
  renderAdditionalChefRequirements();
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
}
