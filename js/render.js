import { CHEF_ROLES, CORE_SECTIONS, DISPLAY_SECTIONS, MIO_ROTATION_ORDER, TARGET_HOURS } from './constants.js';
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
import { validateRotaHardRules, validateRotaSoftRules } from './validation.js?v=20260716c';
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

function getGtTargetForChef(chefName, mioChefName) {
  return chefName === mioChefName ? 2 : 4;
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
    : (hasRota ? validateRotaHardRules({ rota: week.rota, state, inputs, summary: week.summary || [] }) : []);
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
  const hasHoursProblem = totalHours > (TARGET_HOURS.weekly + HOURS_DEVIATION_THRESHOLD)
    || (totalHours > 0 && totalHours < (TARGET_HOURS.weekly - HOURS_DEVIATION_THRESHOLD));
  return {
    gt: item.gtDays > getGtTargetForChef(item.name, view.inputs.mioChef),
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
    return `
      <tr class="${hasProblem ? 'summary-row-problem' : ''}">
        <th scope="row">${escapeHtml(item.name)}</th>
        <td${problems.gt ? ' class="metric-problem"' : ''}>${item.gtDays}/${getGtTargetForChef(item.name, view.inputs.mioChef)}</td>
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
  const ordered = MIO_ROTATION_ORDER.filter((name) => eligibleChefs.some((chef) => chef.name === name));
  const remaining = eligibleChefs.map((chef) => chef.name).filter((name) => !ordered.includes(name));
  return [...ordered, ...remaining];
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

  for (let weekIndex = 0; weekIndex < numWeeks; weekIndex += 1) {
    const currentWeekStart = getWeekStartAtOffset(weekStart, weekIndex);
    const existing = selections[currentWeekStart] || (weekIndex === 0 ? state.weeklyInputs.mioChef : '');
    if (eligible.some((chef) => chef.name === existing)) {
      selections[currentWeekStart] = existing;
      continue;
    }
    selections[currentWeekStart] = rotation[weekIndex % Math.max(rotation.length, 1)] || eligible[0]?.name || '';
  }

  const firstWeekSelection = selections[weekStart] || eligible[0]?.name || '';
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

export function openAddChefModal() {
  getRequiredElement('newChefName').value = '';
  getRequiredElement('newChefRole').innerHTML = CHEF_ROLES.map((role) => `<option>${role}</option>`).join('');
  getRequiredElement('newChefMio').value = 'true';
  getRequiredElement('newChefWeekendRule').value = '';
  getRequiredElement('newChefFixedDayOff').value = '';
  document.querySelectorAll('.new-skill-select').forEach((select) => { select.value = '0'; });
  getRequiredElement('chefModal').classList.add('open');
}

export function closeAddChefModal() {
  getRequiredElement('chefModal').classList.remove('open');
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

  singleSelect.innerHTML = eligible.map((chef) => `<option value="${escapeHtml(chef.name)}" ${state.weeklyInputs.mioChef === chef.name ? 'selected' : ''}>${escapeHtml(chef.name)}</option>`).join('');

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
    <div class="weekly-mio-grid">
      ${weeks.map((week) => `
        <label class="weekly-mio-item">
          <span>Week ${week.weekIndex + 1} · ${escapeHtml(week.label)}</span>
          <select data-weekly-mio-start="${week.weekStart}">
            ${eligible.map((chef) => `<option value="${escapeHtml(chef.name)}" ${week.chefName === chef.name ? 'selected' : ''}>${escapeHtml(chef.name)}</option>`).join('')}
          </select>
        </label>`).join('')}
    </div>`;
}

export function renderStaffTable() {
  const state = getState();
  const body = getRequiredElement('staffBody');
  body.innerHTML = '';
  state.staff.forEach((chef, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input data-field="name" data-index="${index}" value="${escapeHtml(chef.name)}" /></td>
      <td><select data-field="role" data-index="${index}">${CHEF_ROLES.map((role) => `<option value="${role}" ${chef.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select></td>
      <td><select data-field="mio" data-index="${index}"><option value="true" ${chef.mioEligible ? 'selected' : ''}>Yes</option><option value="false" ${!chef.mioEligible ? 'selected' : ''}>No</option></select></td>
      <td><select data-field="weekend" data-index="${index}"><option value="" ${!chef.weekendRule ? 'selected' : ''}>None</option><option ${chef.weekendRule === 'Works weekends' ? 'selected' : ''}>Works weekends</option><option ${chef.weekendRule === 'Does not work weekends' ? 'selected' : ''}>Does not work weekends</option></select></td>
      <td><select data-field="fixedDay" data-index="${index}"><option value="" ${!chef.fixedDayOff ? 'selected' : ''}>None</option><option value="Monday" ${chef.fixedDayOff === 'Monday' ? 'selected' : ''}>Monday</option><option value="Tuesday" ${chef.fixedDayOff === 'Tuesday' ? 'selected' : ''}>Tuesday</option><option value="Wednesday" ${chef.fixedDayOff === 'Wednesday' ? 'selected' : ''}>Wednesday</option><option value="Thursday" ${chef.fixedDayOff === 'Thursday' ? 'selected' : ''}>Thursday</option><option value="Friday" ${chef.fixedDayOff === 'Friday' ? 'selected' : ''}>Friday</option><option value="Saturday" ${chef.fixedDayOff === 'Saturday' ? 'selected' : ''}>Saturday</option><option value="Sunday" ${chef.fixedDayOff === 'Sunday' ? 'selected' : ''}>Sunday</option></select></td>
      <td><button class="danger small-btn" data-remove-chef="${index}">Remove</button></td>`;

    const strengthRow = document.createElement('tr');
    strengthRow.innerHTML = `
      <td colspan="7">
        <div class="strength-row">Section strength: ${CORE_SECTIONS.map((section) => `<span class="strength-pill">${section}: <select data-skill="${section}" data-index="${index}" class="strength-select strength-value-select">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${chef.skills?.[section] === value ? 'selected' : ''}>${value}</option>`).join('')}</select></span>`).join('')}</div>
      </td>`;

    body.appendChild(row);
    body.appendChild(strengthRow);
  });
  renderMioControls();
}

export function renderAvailabilityTable() {
  const state = getState();
  const body = getRequiredElement('availabilityBody');
  const horizon = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks);
  body.innerHTML = '';
  state.weeklyInputs.availability.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><select class="entry-chef" data-index="${index}">${state.staff.map((staff) => `<option value="${escapeHtml(staff.name)}" ${entry.chef === staff.name ? 'selected' : ''}>${escapeHtml(staff.name)}</option>`).join('')}</select></td>
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
  const dayHeaders = solveResult.rota.map((day) => `<th>${day.dayName}<br><span class="small">${formatDate(day.date)}</span></th>`).join('');
  const sectionCells = DISPLAY_SECTIONS.map((section) => {
    const cells = solveResult.rota.map((day) => {
      if (section === 'Float') {
        const coreAssignments = day.assignments.filter((assignment) => [...CORE_SECTIONS, 'Breakfast'].includes(assignment.section)).map((assignment) => assignment.chef);
        const floatChefs = day.chefs.filter((chef) => !coreAssignments.includes(chef));
        return `<td>${floatChefs.length ? escapeHtml(floatChefs.join(', ')) : '—'}</td>`;
      }
      const matches = day.assignments.filter((assignment) => assignment.section === section);
      return `<td>${matches.length ? escapeHtml(matches.map((assignment) => assignment.chef).join(', ')) : '—'}</td>`;
    }).join('');
    return `<tr><th>${section}</th>${cells}</tr>`;
  }).join('');

  return `
    <section class="results-section">
      <h4>Rota table</h4>
      <table class="rota-table"><thead><tr><th>Section</th>${dayHeaders}</tr></thead><tbody>${sectionCells}</tbody></table>
    </section>`;
}

function renderFairnessSummary(summary = []) {
  if (!summary.length) return '';
  const activeRows = summary.filter(hasFairnessActivity);
  if (!activeRows.length) return '';
  const weightedBurdenValues = activeRows.map((entry) => entry.weightedBurden);
  const spread = weightedBurdenValues.length > 1 ? Math.max(...weightedBurdenValues) - Math.min(...weightedBurdenValues) : 0;
  const rows = summary
    .filter(hasFairnessActivity)
    .map((entry) => `<tr><th scope="row">${escapeHtml(entry.name)}</th><td>${entry.fridayCount}</td><td>${entry.saturdayCount}</td><td>${entry.sundayCount}</td><td>${entry.weightedBurden}</td></tr>`)
    .join('');
  return `
    <section class="results-section">
      <h4>Fairness summary</h4>
      <table class="summary-table fairness-table">
        <thead><tr><th>Chef</th><th>Fridays</th><th>Saturdays</th><th>Sundays</th><th>Weighted burden</th></tr></thead>
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
