import { CHEF_ROLES, CORE_SECTIONS, DISPLAY_SECTIONS, MIO_ROTATION_ORDER } from './constants.js';
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
import { getQualityScore, scoreSoftPreferences } from './scoring.js';
import { buildRota, buildMultiWeekRota } from './solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid } from './validation.js?v=20260716b';
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

function renderWeekHtml(solveResult, state, inputs) {
  const hardValidation = validateRotaHardRules({ rota: solveResult.rota, state, inputs, summary: solveResult.summary });
  const softValidation = validateRotaSoftRules({ rota: solveResult.rota, state, inputs });
  const softScore = scoreSoftPreferences({ state, rota: solveResult.rota, hardValidation });
  const valid = isRotaValid(hardValidation);

  const summaryCards = solveResult.summary.map((item) => `<div class="card"><strong>${escapeHtml(item.name)}</strong><div class="small">${item.hours.toFixed(1)} hrs this week</div></div>`).join('');
  const validationCards = hardValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'bad'}">${item.ruleId}: ${item.message}</div>`).join('');
  const softValidationCards = softValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'warn'}">${item.ruleId}: ${item.message}</div>`).join('');

  const ruleNotes = [];
  if ((inputs.additionalChefRequirements || []).length > 0) {
    const reqText = inputs.additionalChefRequirements
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((req) => {
        const date = parseLocalDate(req.date);
        const label = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return `${label}: +${req.count}`;
      })
      .join(', ');
    ruleNotes.push(`Additional chefs: ${reqText}`);
  }
  if (inputs.mioChef) ruleNotes.push(`MIO selection: ${escapeHtml(inputs.mioChef)}`);

  const qualityScores = {};
  solveResult.rota.forEach((day) => {
    day.assignments.forEach((assignment) => {
      const chef = state.staff.find((staff) => staff.name === assignment.chef);
      if (!chef || assignment.section === 'MIO' || assignment.section === 'Breakfast') return;
      const quality = getQualityScore(chef, assignment.section);
      if (!qualityScores[chef.name]) qualityScores[chef.name] = [];
      qualityScores[chef.name].push({ section: assignment.section, quality });
    });
  });

  const qualityNotes = Object.entries(qualityScores).map(([name, assignments]) => {
    const byQuality = { 3: [], 2: [], 1: [], 0: [] };
    assignments.forEach((assignment) => byQuality[assignment.quality].push(assignment.section));
    const parts = [];
    if (byQuality[3].length) parts.push(`preferred: ${byQuality[3].join(', ')}`);
    if (byQuality[2].length) parts.push(`proficient: ${byQuality[2].join(', ')}`);
    if (byQuality[1].length) parts.push(`training: ${byQuality[1].join(', ')}`);
    return parts.length ? `<span class="small"><strong>${escapeHtml(name)}</strong>: ${parts.join('; ')}</span>` : '';
  }).filter(Boolean);

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

  const scoreLine = `<div class="small">Soft score: ${softScore.score.toFixed(1)}${softScore.capped ? ' (capped due to hard-rule failure)' : ''}</div>`;
  const scoreExplanations = softScore.explanation?.length
    ? `<div class="small">${softScore.explanation.map((line) => `• ${line}`).join('<br>')}</div>`
    : '<div class="small">• No soft-rule trade-offs detected.</div>';

  return `
    <div class="summary-grid">
      <div class="card"><h3 class="mb-6">Weekly context</h3><div class="small">Week commencing: ${formatWeekCommencing(inputs.weekStart)}<br>MIO chef: ${escapeHtml(inputs.mioChef || 'None')}<br>Status: ${escapeHtml(inputs.status)}</div></div>
      <div class="card"><h3 class="mb-6">Hours rota</h3><div class="row">${summaryCards}</div>${scoreLine}<div class="small">Hard validation: ${valid ? 'PASS' : 'FAIL'}</div></div>
    </div>
    <h3 class="mt-16">Rules applied</h3>
    <div>${ruleNotes.length ? ruleNotes.map((note) => `<div class="small">• ${note}</div>`).join('') : '<div class="small">• No extra rules were applied.</div>'}</div>
    <h3 class="mt-16">Validation</h3>
    <div>${validationCards || '<span class="pill good">No issues detected</span>'}</div>
    <h3 class="mt-16">Soft preference checks</h3>
    <div>${softValidationCards || '<span class="pill good">No soft preference checks to report</span>'}</div>
    <h3 class="mt-16">Scoring explanations</h3>
    <div>${scoreExplanations}</div>
    <h3 class="mt-16">Section assignments quality</h3>
    ${qualityNotes.length ? `<div class="quality-box">${qualityNotes.join('<br>')}</div>` : '<div class="small">No section assignments to analyze</div>'}
    <h3 class="mt-16">Rota</h3>
    <table class="rota-table"><thead><tr><th>Section</th>${dayHeaders}</tr></thead><tbody>${sectionCells}</tbody></table>`;
}

function renderFairnessSummary(summary = []) {
  if (!summary.length) return '';
  const rows = summary
    .filter(hasFairnessActivity)
    .map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.weightedBurden}</td><td>${entry.fridayCount}</td><td>${entry.saturdayCount}</td><td>${entry.sundayCount}</td><td>${entry.repeatedSaturdaySundayPairCount}</td><td>${entry.repeatedFullWeekendCount}</td><td>${entry.repeatedExactPatternCount}</td></tr>`)
    .join('');
  if (!rows) return '';
  return `
    <h3 class="mt-16">Overall fairness summary</h3>
    <table class="fairness-table">
      <thead><tr><th>Chef</th><th>Weighted burden</th><th>Fri</th><th>Sat</th><th>Sun</th><th>Repeated Sat/Sun</th><th>Repeated Fri-Sun</th><th>Repeated pattern</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function getInfeasibleMessage(numWeeks) {
  return numWeeks === 1
    ? '<div class="pill bad">No feasible rota could be generated with current hard constraints.</div>'
    : '<div class="pill bad">No feasible rota could be generated for this week with current hard constraints.</div>';
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
  const firstOk = weeks.find((week) => week.status === 'ok');
  state.generatedRotas.current = firstOk || null;

  if (firstOk) {
    const firstHardValidation = validateRotaHardRules({ rota: firstOk.rota, state, inputs: firstOk.inputs, summary: firstOk.summary });
    state.uiState.validation = firstHardValidation;
    state.uiState.softScore = scoreSoftPreferences({ state, rota: firstOk.rota, hardValidation: firstHardValidation });
  } else {
    state.uiState.validation = [];
    state.uiState.softScore = null;
  }

  const activeWeekIndex = Math.max(0, Math.min(state.uiState.selectedResultWeekIndex || 0, Math.max(weeks.length - 1, 0)));
  state.uiState.selectedResultWeekIndex = activeWeekIndex;

  if (overallResult.numberOfWeeks === 1) {
    const week = weeks[0];
    container.innerHTML = week.status === 'infeasible' ? getInfeasibleMessage(1) : renderWeekHtml(week, state, week.inputs);
  } else {
    const tabs = weeks.map((week, index) => `<button class="week-tab ${index === activeWeekIndex ? 'active' : ''}" data-results-week-index="${index}">Week ${index + 1}</button>`).join('');
    const dropdownOptions = weeks.map((week, index) => `<option value="${index}" ${index === activeWeekIndex ? 'selected' : ''}>Week ${index + 1} · ${formatCompactWeekRange(week.weekStart)}</option>`).join('');
    const panels = weeks.map((week, index) => {
      const content = week.status === 'infeasible' ? getInfeasibleMessage(overallResult.numberOfWeeks) : renderWeekHtml(week, state, week.inputs);
      return `<section class="week-panel ${index === activeWeekIndex ? '' : 'hidden'}" data-week-panel="${index}"><h3 class="multi-week-heading">Week ${index + 1} — ${formatWeekCommencing(week.weekStart)}</h3>${content}</section>`;
    }).join('');
    const overallBanner = overallResult.status === 'infeasible'
      ? `<div class="pill bad">Overall result infeasible: Week ${overallResult.failedWeek} (${formatWeekCommencing(overallResult.failedWeekStart)}) failed, so later weeks were not generated.</div>`
      : '<div class="pill good">All selected weeks generated successfully.</div>';

    container.innerHTML = `
      ${overallBanner}
      ${renderFairnessSummary(overallResult.fairnessSummary)}
      <div class="desktop-only week-tabs" role="tablist">${tabs}</div>
      <label class="mobile-only">Week<select id="resultsWeekSelect">${dropdownOptions}</select></label>
      <div class="week-panels">${panels}</div>`;
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
        weekMioChefs: weeks.map((week) => week.mioChef)
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
