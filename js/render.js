import { CHEF_ROLES, CORE_SECTIONS, DISPLAY_SECTIONS } from './constants.js';
import { getState } from './state.js';
import { formatDate, formatWeekCommencing, parseLocalDate } from './utils.js';
import { getQualityScore, scoreSoftPreferences } from './scoring.js';
import { buildMultiWeekRota } from './solver.js';
import { validateRotaHardRules, validateRotaSoftRules, isRotaValid } from './validation.js?v=20260714';
import { collectWeeklyInputsFromDom } from './weekly-inputs.js';

export function openAddChefModal() {
  document.getElementById('newChefName').value = '';
  document.getElementById('newChefRole').innerHTML = CHEF_ROLES.map((role) => `<option>${role}</option>`).join('');
  document.getElementById('newChefMio').value = 'true';
  document.getElementById('newChefWeekendRule').value = '';
  document.getElementById('newChefFixedDayOff').value = '';
  document.querySelectorAll('.new-skill-select').forEach((select) => { select.value = '0'; });
  document.getElementById('chefModal').classList.add('open');
}

export function closeAddChefModal() {
  document.getElementById('chefModal').classList.remove('open');
}

export function renderAdditionalChefRequirements() {
  const state = getState();
  const container = document.getElementById('additionalChefList');
  if (!container) return;
  const reqs = (state.weeklyInputs.additionalChefRequirements || []).slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!reqs.length) {
    container.innerHTML = '<p class="small chef-req-empty">No additional staffing requests for this week.</p>';
    return;
  }

  container.innerHTML = reqs.map((req) => {
    const d = parseLocalDate(req.date);
    const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const chefWord = req.count === 1 ? 'chef' : 'chefs';
    return `<div class="chef-req-row">
      <span class="chef-req-label">${label} — +${req.count} ${chefWord}</span>
      <button class="secondary small-btn" data-edit-req="${req.date}" aria-label="Edit additional chef request for ${label}">Edit</button>
      <button class="danger small-btn" data-remove-req="${req.date}" aria-label="Remove additional chef request for ${label}">Remove</button>
    </div>`;
  }).join('');
}

export function renderMioOptions() {
  const state = getState();
  const select = document.getElementById('mioChef');
  const current = state.weeklyInputs.mioChef || select.value || state.staff.find((s) => s.mioEligible)?.name || '';
  const eligible = state.staff.filter((s) => s.mioEligible);
  select.innerHTML = eligible.map((s) => `<option value="${s.name}" ${current === s.name ? 'selected' : ''}>${s.name}</option>`).join('');
  if (!eligible.some((s) => s.name === current)) {
    state.weeklyInputs.mioChef = eligible[0]?.name || '';
    select.value = state.weeklyInputs.mioChef;
  }
}

export function renderStaffTable() {
  const state = getState();
  const body = document.getElementById('staffBody');
  body.innerHTML = '';
  state.staff.forEach((chef, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input data-field="name" data-index="${index}" value="${chef.name}" /></td>
      <td><select data-field="role" data-index="${index}">${CHEF_ROLES.map((role) => `<option value="${role}" ${chef.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select></td>
      <td><select data-field="mio" data-index="${index}"><option value="true" ${chef.mioEligible ? 'selected' : ''}>Yes</option><option value="false" ${!chef.mioEligible ? 'selected' : ''}>No</option></select></td>
      <td><select data-field="weekend" data-index="${index}"><option value="" ${!chef.weekendRule ? 'selected' : ''}>None</option><option ${chef.weekendRule === 'Works weekends' ? 'selected' : ''}>Works weekends</option><option ${chef.weekendRule === 'Does not work weekends' ? 'selected' : ''}>Does not work weekends</option></select></td>
      <td><select data-field="fixedDay" data-index="${index}"><option value="" ${!chef.fixedDayOff ? 'selected' : ''}>None</option><option value="Monday" ${chef.fixedDayOff === 'Monday' ? 'selected' : ''}>Monday</option><option value="Tuesday" ${chef.fixedDayOff === 'Tuesday' ? 'selected' : ''}>Tuesday</option><option value="Wednesday" ${chef.fixedDayOff === 'Wednesday' ? 'selected' : ''}>Wednesday</option><option value="Thursday" ${chef.fixedDayOff === 'Thursday' ? 'selected' : ''}>Thursday</option><option value="Friday" ${chef.fixedDayOff === 'Friday' ? 'selected' : ''}>Friday</option><option value="Saturday" ${chef.fixedDayOff === 'Saturday' ? 'selected' : ''}>Saturday</option><option value="Sunday" ${chef.fixedDayOff === 'Sunday' ? 'selected' : ''}>Sunday</option></select></td>
      <td><button class="danger small-btn" data-remove-chef="${index}">Remove</button></td>`;

    const strengthRow = document.createElement('tr');
    strengthRow.innerHTML = `
      <td colspan="7">
        <div class="strength-row">Section strength: ${CORE_SECTIONS.map((section) => `<span class="strength-pill">${section}: <select data-skill="${section}" data-index="${index}" class="strength-select strength-value-select">${[0, 1, 2, 3].map((v) => `<option value="${v}" ${chef.skills?.[section] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></span>`).join('')}</div>
      </td>`;

    body.appendChild(row);
    body.appendChild(strengthRow);
  });
  renderMioOptions();
}

export function renderAvailabilityTable() {
  const state = getState();
  const body = document.getElementById('availabilityBody');
  body.innerHTML = '';
  state.weeklyInputs.availability.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><select class="entry-chef" data-index="${index}">${state.staff.map((s) => `<option value="${s.name}" ${entry.chef === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}</select></td>
      <td><select class="entry-type" data-index="${index}"><option ${entry.type === 'Annual Leave' ? 'selected' : ''}>Annual Leave</option><option ${entry.type === 'Unavailable' ? 'selected' : ''}>Unavailable</option></select></td>
      <td><input class="entry-start-date" type="date" data-index="${index}" value="${entry.startDate || ''}"></td>
      <td><input class="entry-finish-date" type="date" data-index="${index}" value="${entry.finishDate || ''}"></td>
      <td><input class="entry-notes" type="text" data-index="${index}" value="${entry.notes || ''}"></td>
      <td><button class="danger" data-remove="${index}">Remove</button></td>`;
    body.appendChild(row);
  });
}

function renderWeekHtml(solveResult, state, inputs) {
  const hardValidation = validateRotaHardRules({ rota: solveResult.rota, state, inputs, summary: solveResult.summary });
  const softValidation = validateRotaSoftRules({ rota: solveResult.rota, state, inputs });
  const softScore = scoreSoftPreferences({ state, rota: solveResult.rota, hardValidation });
  const valid = isRotaValid(hardValidation);

  const summaryCards = solveResult.summary.map((item) => `<div class="card"><strong>${item.name}</strong><div class="small">${item.hours.toFixed(1)} hrs this week</div></div>`).join('');
  const validationCards = hardValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'bad'}">${item.ruleId}: ${item.message}</div>`).join('');
  const softValidationCards = softValidation.map((item) => `<div class="pill ${item.passed ? 'good' : 'warn'}">${item.ruleId}: ${item.message}</div>`).join('');

  const ruleNotes = [];
  if ((inputs.additionalChefRequirements || []).length > 0) {
    const reqText = inputs.additionalChefRequirements
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => {
        const d = parseLocalDate(r.date);
        const lbl = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return `${lbl}: +${r.count}`;
      })
      .join(', ');
    ruleNotes.push(`Additional chefs: ${reqText}`);
  }
  if (inputs.mioChef) ruleNotes.push(`MIO selection: ${inputs.mioChef}`);

  const qualityScores = {};
  solveResult.rota.forEach((day) => {
    day.assignments.forEach((assignment) => {
      const chef = state.staff.find((s) => s.name === assignment.chef);
      if (!chef || assignment.section === 'MIO' || assignment.section === 'Breakfast') return;
      const quality = getQualityScore(chef, assignment.section);
      if (!qualityScores[chef.name]) qualityScores[chef.name] = [];
      qualityScores[chef.name].push({ section: assignment.section, quality });
    });
  });

  const qualityNotes = Object.entries(qualityScores).map(([name, assignments]) => {
    const byQuality = { 3: [], 2: [], 1: [], 0: [] };
    assignments.forEach((a) => byQuality[a.quality].push(a.section));
    const parts = [];
    if (byQuality[3].length) parts.push(`preferred: ${byQuality[3].join(', ')}`);
    if (byQuality[2].length) parts.push(`proficient: ${byQuality[2].join(', ')}`);
    if (byQuality[1].length) parts.push(`training: ${byQuality[1].join(', ')}`);
    return parts.length ? `<span class="small"><strong>${name}</strong>: ${parts.join('; ')}</span>` : '';
  }).filter(Boolean);

  const dayHeaders = solveResult.rota.map((day) => `<th>${day.dayName}<br><span class="small">${formatDate(day.date)}</span></th>`).join('');
  const sectionCells = DISPLAY_SECTIONS.map((section) => {
    const cells = solveResult.rota.map((day) => {
      if (section === 'Float') {
        const coreAssignments = day.assignments.filter((a) => [...CORE_SECTIONS, 'Breakfast'].includes(a.section)).map((a) => a.chef);
        const floatChefs = day.chefs.filter((chef) => !coreAssignments.includes(chef));
        return `<td>${floatChefs.length ? floatChefs.join(', ') : '—'}</td>`;
      }
      const matches = day.assignments.filter((assignment) => assignment.section === section);
      return `<td>${matches.length ? matches.map((a) => a.chef).join(', ') : '—'}</td>`;
    }).join('');
    return `<tr><th>${section}</th>${cells}</tr>`;
  }).join('');

  const scoreLine = `<div class="small">Soft score: ${softScore.score.toFixed(1)}${softScore.capped ? ' (capped due to hard-rule failure)' : ''}</div>`;
  const scoreExplanations = softScore.explanation?.length
    ? `<div class="small">${softScore.explanation.map((line) => `• ${line}`).join('<br>')}</div>`
    : '<div class="small">• No soft-rule trade-offs detected.</div>';

  return `
    <div class="summary-grid">
      <div class="card"><h3 class="mb-6">Weekly context</h3><div class="small">Week commencing: ${formatWeekCommencing(inputs.weekStart)}<br>MIO chef: ${inputs.mioChef || 'None'}<br>Status: ${inputs.status}</div></div>
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

export function renderResultsPanel() {
  const state = getState();
  const inputs = collectWeeklyInputsFromDom();
  const container = document.getElementById('results');
  const numWeeks = inputs.numWeeks || 1;
  const weekResults = buildMultiWeekRota(inputs, numWeeks);

  // Keep current rota pointing to the first feasible week (backward compatibility)
  const firstOk = weekResults.find((r) => r.status === 'ok');
  state.generatedRotas.current = firstOk || weekResults[0];

  // Populate uiState with first feasible week's validation for external consumers
  if (firstOk) {
    const firstOkInputs = { ...inputs, weekStart: firstOk.weekStart };
    const firstHardValidation = validateRotaHardRules({ rota: firstOk.rota, state, inputs: firstOkInputs, summary: firstOk.summary });
    state.uiState.validation = firstHardValidation;
    state.uiState.softScore = scoreSoftPreferences({ state, rota: firstOk.rota, hardValidation: firstHardValidation });
  } else {
    state.uiState.validation = [];
    state.uiState.softScore = null;
  }

  if (numWeeks === 1) {
    const solveResult = weekResults[0];
    if (solveResult.status === 'infeasible') {
      container.innerHTML = `<div class="pill bad">No feasible rota could be generated with current hard constraints.</div>`;
      return;
    }
    const weekInputs = { ...inputs, weekStart: solveResult.weekStart };
    container.innerHTML = renderWeekHtml(solveResult, state, weekInputs);
    return;
  }

  // Multi-week display
  const allInfeasible = weekResults.every((r) => r.status === 'infeasible');
  if (allInfeasible) {
    container.innerHTML = `<div class="pill bad">No feasible rota could be generated for any week with current hard constraints.</div>`;
    return;
  }

  container.innerHTML = weekResults.map((weekResult, i) => {
    const weekLabel = `Week ${i + 1} — ${formatWeekCommencing(weekResult.weekStart)}`;
    const weekInputs = { ...inputs, weekStart: weekResult.weekStart };
    const weekBody = weekResult.status === 'infeasible'
      ? `<div class="pill bad">No feasible rota could be generated for this week with current hard constraints.</div>`
      : renderWeekHtml(weekResult, state, weekInputs);
    return `<div class="multi-week-section"><h3 class="multi-week-heading">${weekLabel}</h3>${weekBody}</div>`;
  }).join('');
}

export function renderAll() {
  renderAdditionalChefRequirements();
  renderStaffTable();
  renderAvailabilityTable();
  renderResultsPanel();
}
