import { CHEF_ROLES, CORE_SECTIONS, DISPLAY_SECTIONS } from './constants.js';
import { getState } from './state.js';
import { formatDate, formatWeekCommencing, getPlanningHorizon, getPlanningWeekStarts, parseLocalDate } from './utils.js';
import { getQualityScore, scoreSoftPreferences } from './scoring.js';
import { buildMultiWeekRota } from './solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid } from './validation.js?v=20260714';
import { collectWeeklyInputsFromDom, ensureMioSelectionsForPlanningHorizon, getEligibleMioChefs } from './weekly-inputs.js';

function getSafeElement(id) {
  return document.getElementById(id);
}

// HTML/text escaping only; do not use this helper for script, style, or URL-building contexts.
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderWeekRangeLabel(weekStart) {
  const monday = parseLocalDate(weekStart);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${formatDate(weekStart)} – ${formatDate(`${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`)}`;
}

export function renderAdditionalChefRequirements() {
  const state = getState();
  const container = getSafeElement('additionalChefList');
  if (!container) return;
  const reqs = (state.weeklyInputs.additionalChefRequirements || []).slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!reqs.length) {
    container.innerHTML = '<p class="small chef-req-empty">No additional staffing requests for this planning period.</p>';
    return;
  }

  container.innerHTML = reqs.map((req) => {
    const date = parseLocalDate(req.date);
    const label = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const chefWord = req.count === 1 ? 'chef' : 'chefs';
    return `<div class="chef-req-row">
      <span class="chef-req-label">${escapeHtml(label)} — +${req.count} ${chefWord}</span>
      <button class="secondary small-btn" data-edit-req="${escapeHtml(req.date)}" aria-label="Edit additional chef request for ${escapeHtml(label)}">Edit</button>
      <button class="danger small-btn" data-remove-req="${escapeHtml(req.date)}" aria-label="Remove additional chef request for ${escapeHtml(label)}">Remove</button>
    </div>`;
  }).join('');
}

export function renderMioOptions() {
  const state = getState();
  const select = getSafeElement('mioChef');
  const wrapper = getSafeElement('singleWeekMioControl');
  if (!select) return;
  ensureMioSelectionsForPlanningHorizon(state);
  const current = state.weeklyInputs.mioChef || state.staff.find((staff) => staff.mioEligible)?.name || '';
  const eligible = getEligibleMioChefs(state);
  select.innerHTML = eligible.map((name) => `<option value="${escapeHtml(name)}" ${current === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  if (!eligible.includes(current)) {
    state.weeklyInputs.mioChef = eligible[0] || '';
    select.value = state.weeklyInputs.mioChef;
  }
  if (wrapper) wrapper.hidden = (state.weeklyInputs.numWeeks || 1) > 1;
}

export function renderWeeklyMioPlan() {
  const state = getState();
  const container = getSafeElement('weeklyMioPlan');
  if (!container) return;

  ensureMioSelectionsForPlanningHorizon(state);
  const numWeeks = state.weeklyInputs.numWeeks || 1;
  if (numWeeks === 1) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  const eligible = getEligibleMioChefs(state);
  const weekStarts = getPlanningWeekStarts(state.weeklyInputs.weekStart, numWeeks);
  const selections = state.weeklyInputs.mioSelectionsByWeek || {};
  container.hidden = false;
  container.innerHTML = `
    <h3 class="mb-8">Weekly MIO plan</h3>
    <div class="weekly-mio-plan-grid">
      ${weekStarts.map((weekStart, index) => `
        <label class="weekly-mio-card">
          <span class="weekly-mio-heading">Week ${index + 1} · ${escapeHtml(renderWeekRangeLabel(weekStart))}</span>
          <select class="weekly-mio-select" data-week-start="${escapeHtml(weekStart)}">
            ${eligible.map((name) => `<option value="${escapeHtml(name)}" ${selections[weekStart] === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </label>
      `).join('')}
    </div>`;
}

export function renderStaffTable() {
  const state = getState();
  const body = getSafeElement('staffBody');
  if (!body) return;
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
  renderMioOptions();
  renderWeeklyMioPlan();
}

export function renderAvailabilityTable() {
  const state = getState();
  const body = getSafeElement('availabilityBody');
  if (!body) return;
  body.innerHTML = '';
  const { startDate, endDate } = getPlanningHorizon(state.weeklyInputs.weekStart, state.weeklyInputs.numWeeks || 1);
  state.weeklyInputs.availability.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><select class="entry-chef" data-index="${index}">${state.staff.map((staff) => `<option value="${escapeHtml(staff.name)}" ${entry.chef === staff.name ? 'selected' : ''}>${escapeHtml(staff.name)}</option>`).join('')}</select></td>
      <td><select class="entry-type" data-index="${index}"><option ${entry.type === 'Annual Leave' ? 'selected' : ''}>Annual Leave</option><option ${entry.type === 'Unavailable' ? 'selected' : ''}>Unavailable</option></select></td>
      <td><input class="entry-start-date" type="date" data-index="${index}" min="${startDate}" max="${endDate}" value="${entry.startDate || ''}"></td>
      <td><input class="entry-finish-date" type="date" data-index="${index}" min="${startDate}" max="${endDate}" value="${entry.finishDate || ''}"></td>
      <td><input class="entry-notes" type="text" data-index="${index}" value="${escapeHtml(entry.notes || '')}"></td>
      <td><button class="danger" data-remove="${index}">Remove</button></td>`;
    body.appendChild(row);
  });
}

function renderFairnessSummary(fairnessSummary) {
  if (!fairnessSummary?.length) return '';
  return `
    <div class="card mt-16">
      <h3 class="mb-6">Multi-week fairness summary</h3>
      <table class="fairness-table">
        <thead>
          <tr><th>Chef</th><th>Friday shifts</th><th>Saturday shifts</th><th>Sunday shifts</th><th>Weighted burden</th></tr>
        </thead>
        <tbody>
          ${fairnessSummary.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.fridayShifts}</td><td>${item.saturdayShifts}</td><td>${item.sundayShifts}</td><td>${item.weightedBurden}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderWeekHtml(weekResult, state, inputs) {
  const hardValidation = weekResult.hardValidation || validateRotaHardRules({ rota: weekResult.rota, state, inputs, summary: weekResult.summary });
  const softValidation = validateRotaSoftRules({ rota: weekResult.rota, state, inputs });
  const softScore = scoreSoftPreferences({ state, rota: weekResult.rota, hardValidation });
  const valid = isRotaValid(hardValidation);

  const summaryCards = weekResult.summary.map((item) => `<div class="card"><strong>${escapeHtml(item.name)}</strong><div class="small">${item.hours.toFixed(1)} hrs this week</div></div>`).join('');
  const validationCards = hardValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'bad'}">${escapeHtml(item.ruleId)}: ${escapeHtml(item.message)}</div>`).join('');
  const softValidationCards = softValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'warn'}">${escapeHtml(item.ruleId)}: ${escapeHtml(item.message)}</div>`).join('');

  const ruleNotes = [];
  const weekRequests = (inputs.additionalChefRequirements || []).filter((item) => {
    const weekStarts = getPlanningWeekStarts(inputs.weekStart, 1);
    const start = weekStarts[0];
    const { endDate } = getPlanningHorizon(start, 1);
    return item.date >= start && item.date <= endDate;
  });
  if (weekRequests.length) {
    ruleNotes.push(`Additional chefs: ${weekRequests
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => `${formatDate(item.date)}: +${item.count}`)
      .join(', ')}`);
  }
  if (weekResult.mioChef) ruleNotes.push(`MIO selection: ${weekResult.mioChef}`);

  const qualityScores = {};
  weekResult.rota.forEach((day) => {
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
    if (byQuality[3].length) parts.push(`preferred: ${byQuality[3].map((section) => escapeHtml(section)).join(', ')}`);
    if (byQuality[2].length) parts.push(`proficient: ${byQuality[2].map((section) => escapeHtml(section)).join(', ')}`);
    if (byQuality[1].length) parts.push(`training: ${byQuality[1].map((section) => escapeHtml(section)).join(', ')}`);
    return parts.length ? `<span class="small"><strong>${escapeHtml(name)}</strong>: ${parts.join('; ')}</span>` : '';
  }).filter(Boolean);

  const dayHeaders = weekResult.rota.map((day) => `<th>${escapeHtml(day.dayName)}<br><span class="small">${escapeHtml(formatDate(day.date))}</span></th>`).join('');
  const sectionCells = DISPLAY_SECTIONS.map((section) => {
    const cells = weekResult.rota.map((day) => {
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
      <div class="card"><h3 class="mb-6">Weekly context</h3><div class="small">Week commencing: ${escapeHtml(formatWeekCommencing(weekResult.weekStart))}<br>MIO chef: ${escapeHtml(weekResult.mioChef || 'None')}<br>Status: ${escapeHtml(weekResult.status)}</div></div>
      <div class="card"><h3 class="mb-6">Hours rota</h3><div class="row">${summaryCards}</div>${scoreLine}<div class="small">Hard validation: ${valid ? 'PASS' : 'FAIL'}</div></div>
    </div>
    <h3 class="mt-16">Rules applied</h3>
    <div>${ruleNotes.length ? ruleNotes.map((note) => `<div class="small">• ${escapeHtml(note)}</div>`).join('') : '<div class="small">• No extra rules were applied.</div>'}</div>
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

function renderWeekSwitcher(weekResults, activeWeekIndex) {
  if (weekResults.length <= 1) return '';
  return `
    <div class="week-switcher">
      <div class="week-tabs" role="tablist" aria-label="Generated weeks">
        ${weekResults.map((week, index) => `<button type="button" class="week-tab ${index === activeWeekIndex ? 'is-active' : ''}" data-week-tab="${index}" aria-selected="${index === activeWeekIndex}">Week ${week.weekIndex}</button>`).join('')}
      </div>
      <label class="mobile-week-picker">
        <span class="small">Week</span>
        <select id="mobileWeekSelect">
          ${weekResults.map((week, index) => `<option value="${index}" ${index === activeWeekIndex ? 'selected' : ''}>Week ${week.weekIndex} · ${escapeHtml(formatWeekCommencing(week.weekStart))}</option>`).join('')}
        </select>
      </label>
    </div>`;
}

export function renderResultsPanel() {
  const state = getState();
  const inputs = collectWeeklyInputsFromDom();
  const container = getSafeElement('results');
  if (!container) return;

  const buildResult = buildMultiWeekRota(inputs, inputs.numWeeks || 1);
  const weekResults = buildResult.weeks || [];
  const maxIndex = Math.max(0, weekResults.length - 1);
  state.uiState.activeWeekIndex = Math.min(state.uiState.activeWeekIndex || 0, maxIndex);
  const activeWeek = weekResults[state.uiState.activeWeekIndex] || null;

  state.generatedRotas.lastBuild = buildResult;
  state.generatedRotas.current = activeWeek;

  if (activeWeek?.status === 'ok') {
    state.uiState.validation = activeWeek.hardValidation || [];
    state.uiState.softScore = scoreSoftPreferences({ state, rota: activeWeek.rota, hardValidation: activeWeek.hardValidation || [] });
  } else {
    state.uiState.validation = [];
    state.uiState.softScore = null;
  }

  if ((inputs.numWeeks || 1) === 1) {
    if (!activeWeek) {
      container.innerHTML = '<div class="pill bad">No feasible rota could be generated with current hard constraints.</div>';
      return;
    }
    container.innerHTML = activeWeek.status === 'ok'
      ? renderWeekHtml(activeWeek, state, { ...inputs, weekStart: activeWeek.weekStart })
      : '<div class="pill bad">No feasible rota could be generated with current hard constraints.</div>';
    return;
  }

  const activeWeekBody = activeWeek
    ? renderWeekHtml(activeWeek, state, { ...inputs, weekStart: activeWeek.weekStart })
    : '<div class="pill bad">No feasible rota could be generated with current hard constraints.</div>';

  const bannerMessage = buildResult.status === 'infeasible'
    ? `Generation stopped at Week ${buildResult.failedWeek} (${formatWeekCommencing(buildResult.failedWeekStart)}): ${buildResult.reason}`
    : 'All selected weeks were generated successfully.';
  const bannerClass = buildResult.status === 'infeasible' ? 'pill bad' : 'pill good';

  container.innerHTML = `
    ${renderFairnessSummary(buildResult.fairnessSummary)}
    ${renderWeekSwitcher(weekResults, state.uiState.activeWeekIndex)}
    <div class="multi-week-stage">${activeWeekBody}</div>`;
  const banner = document.createElement('div');
  banner.className = bannerClass;
  banner.textContent = bannerMessage;
  container.prepend(banner);
}

export function renderAll() {
  renderAdditionalChefRequirements();
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
}
