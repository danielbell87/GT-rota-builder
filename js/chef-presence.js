import { CORE_SECTIONS } from './constants.js';

const GT_SECTIONS = new Set([...CORE_SECTIONS, 'Float']);
const WEEKEND_DAYS = new Set(['Saturday', 'Sunday']);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function chefIdForAssignment(assignment, state) {
  if (assignment?.chefId && state.staff.some((chef) => chef.id === assignment.chefId)) return assignment.chefId;
  return state.staff.find((chef) => chef.name === assignment?.chef)?.id || '';
}

function availabilityForDate(inputs, chefName, date) {
  const entries = (inputs?.availability || []).filter((entry) => {
    const start = entry.startDate || entry.date;
    const finish = entry.finishDate || entry.startDate || entry.date;
    return entry.chef === chefName && !!start && date >= start && date <= finish;
  });
  if (entries.some((entry) => entry.type === 'Annual Leave')) return 'leave';
  if (entries.some((entry) => entry.type === 'Unavailable')) return 'unavailable';
  return '';
}

export function buildChefPresenceWeek({ state, week, chefId }) {
  const chef = state.staff.find((item) => item.id === chefId);
  if (!chef || !week?.rota?.length) return null;

  const sectionCounts = {};
  const days = week.rota.map((day) => {
    const assignments = (day.assignments || []).filter((assignment) => chefIdForAssignment(assignment, state) === chefId);
    assignments.forEach((assignment) => {
      sectionCounts[assignment.section] = (sectionCounts[assignment.section] || 0) + 1;
    });
    const gtAssignments = assignments.filter((assignment) => GT_SECTIONS.has(assignment.section));
    const availability = assignments.length ? '' : availabilityForDate(week.inputs || state.weeklyInputs, chef.name, day.date);
    return {
      date: day.date,
      dayName: day.dayName,
      assignments,
      working: assignments.length > 0,
      gtWorking: gtAssignments.length > 0,
      status: assignments.length ? 'working' : (availability || 'rest')
    };
  });

  return {
    chefId,
    chefName: chef.name,
    weekIndex: Number(week.weekIndex || 0),
    weekStart: week.weekStart,
    days,
    gtShifts: days.filter((day) => day.gtWorking).length,
    sectionCounts,
    leaveDays: days.filter((day) => day.status === 'leave').length,
    unavailableDays: days.filter((day) => day.status === 'unavailable').length,
    restDays: days.filter((day) => day.status === 'rest').length,
    weekendWorked: days.filter((day) => day.working && WEEKEND_DAYS.has(day.dayName)).map((day) => day.dayName)
  };
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function getChefPresenceSummaryRows(presence) {
  if (!presence) return [];
  const rows = [];
  if (presence.gtShifts) rows.push(plural(presence.gtShifts, 'GT shift'));
  if (presence.sectionCounts.Breakfast) rows.push(plural(presence.sectionCounts.Breakfast, 'Breakfast'));
  if (presence.sectionCounts.Float) rows.push(plural(presence.sectionCounts.Float, 'Float'));
  CORE_SECTIONS.forEach((section) => {
    const count = presence.sectionCounts[section] || 0;
    if (count) rows.push(`${count} ${section}`);
  });
  if (presence.leaveDays) rows.push(plural(presence.leaveDays, 'Annual Leave day'));
  if (presence.unavailableDays) rows.push(plural(presence.unavailableDays, 'Unavailable day'));
  if (presence.restDays) rows.push(plural(presence.restDays, 'Rest Day'));
  if (presence.weekendWorked.length) rows.push(`Weekend worked: ${presence.weekendWorked.join(' & ')}`);
  return rows;
}

function cellContainsChef(cell, chefId) {
  return String(cell.dataset.chefIds || '').split(' ').filter(Boolean).includes(chefId);
}

function statusMarkup(status) {
  const labels = {
    leave: ['Annual Leave', '<path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="m9 14 2 2 4-4"/>'],
    unavailable: ['Unavailable', '<path d="M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="m9 13 6 6m0-6-6 6"/>'],
    rest: ['Rest Day', '<circle cx="12" cy="12" r="9"/><path d="M10 9v6m4-6v6"/>']
  };
  const [label, paths] = labels[status];
  return `<span class="chef-presence-status chef-presence-status-${status}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>${label}</span>`;
}

function positionCard(card, anchor) {
  if (!card || !anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  const gap = 10;
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  let left = rect.right + gap;
  if (left + width > window.innerWidth - 10) left = rect.left - width - gap;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
  let top = rect.top + (rect.height / 2) - (height / 2);
  top = Math.max(10, Math.min(top, window.innerHeight - height - 10));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

export function initChefPresence({ getState }) {
  let active = null;
  let clearTimer = 0;

  const clear = ({ keepPinned = false } = {}) => {
    window.clearTimeout(clearTimer);
    if (keepPinned && active?.pinned) return;
    document.querySelectorAll('.chef-presence-active').forEach((element) => element.classList.remove('chef-presence-active'));
    document.querySelectorAll('.chef-presence-match,.chef-presence-muted,.chef-presence-origin').forEach((element) => {
      element.classList.remove('chef-presence-match', 'chef-presence-muted', 'chef-presence-origin');
    });
    document.querySelectorAll('[data-presence-status]').forEach((element) => delete element.dataset.presenceStatus);
    document.querySelectorAll('.chef-presence-status,.chef-presence-card').forEach((element) => element.remove());
    document.querySelectorAll('[data-chef-presence-trigger][aria-pressed="true"]').forEach((element) => element.setAttribute('aria-pressed', 'false'));
    active = null;
  };

  const activate = (trigger, { pinned = false } = {}) => {
    const state = getState();
    const weekIndex = Number(trigger.dataset.weekIndex || 0);
    const week = state.generatedRotas.latestResult?.weeks?.[weekIndex];
    const presence = buildChefPresenceWeek({ state, week, chefId: trigger.dataset.chefId });
    const panel = trigger.closest('.week-panel');
    if (!presence || !panel) return;

    clear();
    active = { trigger, chefId: presence.chefId, weekIndex, pinned };
    panel.classList.add('chef-presence-active');
    trigger.classList.add('chef-presence-origin');
    if (pinned) trigger.setAttribute('aria-pressed', 'true');

    panel.querySelectorAll('[data-rota-cell]').forEach((cell) => {
      const hasAssignments = Number(cell.dataset.chefCount || 0) > 0;
      if (cellContainsChef(cell, presence.chefId)) cell.classList.add('chef-presence-match');
      else if (hasAssignments) cell.classList.add('chef-presence-muted');
    });
    panel.querySelectorAll('[data-chef-presence-trigger]').forEach((name) => {
      if (name.dataset.chefId === presence.chefId) name.classList.add('chef-presence-match');
    });

    presence.days.forEach((day) => {
      panel.querySelectorAll(`[data-rota-day-header][data-date="${day.date}"]`).forEach((header) => {
        header.dataset.presenceStatus = day.status;
      });
      if (day.status === 'working') return;
      const emptyCell = [...panel.querySelectorAll(`.rota-table [data-rota-cell][data-date="${day.date}"]`)]
        .find((cell) => Number(cell.dataset.chefCount || 0) === 0 && !cell.classList.contains('hard-rule-affected'));
      if (emptyCell) emptyCell.insertAdjacentHTML('beforeend', statusMarkup(day.status));
      else {
        const header = panel.querySelector(`.rota-table [data-rota-day-header][data-date="${day.date}"]`);
        header?.insertAdjacentHTML('beforeend', statusMarkup(day.status).replace('chef-presence-status ', 'chef-presence-status chef-presence-status-fallback '));
      }
      const selectedDay = panel.querySelector(`.day-rota-view[data-selected-date="${day.date}"]`);
      const emptyDayRow = selectedDay
        ? [...selectedDay.querySelectorAll('[data-rota-cell]')].find((cell) => Number(cell.dataset.chefCount || 0) === 0 && !cell.closest('.hard-rule-affected'))
        : null;
      if (emptyDayRow) emptyDayRow.insertAdjacentHTML('beforeend', statusMarkup(day.status));
      else if (selectedDay) {
        selectedDay.querySelector('h4')?.insertAdjacentHTML('beforeend', statusMarkup(day.status).replace('chef-presence-status ', 'chef-presence-status chef-presence-status-inline '));
      }
    });

    const rows = getChefPresenceSummaryRows(presence);
    document.body.insertAdjacentHTML('beforeend', `<aside class="chef-presence-card print-hidden" aria-hidden="true"><strong>${escapeHtml(presence.chefName)}</strong>${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}</aside>`);
    positionCard(document.querySelector('.chef-presence-card'), trigger);
  };

  const scheduleClear = () => {
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => clear({ keepPinned: true }), 35);
  };

  document.addEventListener('mouseover', (event) => {
    const trigger = event.target.closest?.('[data-chef-presence-trigger]');
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) activate(trigger);
  });
  document.addEventListener('mouseout', (event) => {
    const trigger = event.target.closest?.('[data-chef-presence-trigger]');
    if (trigger && !trigger.contains(event.relatedTarget)) scheduleClear();
  });
  document.addEventListener('focusin', (event) => {
    const trigger = event.target.closest?.('[data-chef-presence-trigger]');
    if (trigger) activate(trigger, { pinned: active?.pinned && active.trigger === trigger });
  });
  document.addEventListener('focusout', (event) => {
    if (event.target.closest?.('[data-chef-presence-trigger]')) scheduleClear();
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-chef-presence-trigger]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const samePinned = active?.pinned && active.chefId === trigger.dataset.chefId && active.weekIndex === Number(trigger.dataset.weekIndex || 0);
    if (samePinned) clear();
    else activate(trigger, { pinned: true });
  }, true);
  document.addEventListener('keydown', (event) => {
    const trigger = event.target.closest?.('[data-chef-presence-trigger]');
    if (trigger && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      trigger.click();
      return;
    }
    if (event.key === 'Escape' && active) clear();
  }, true);
  document.addEventListener('rota:before-results-render', () => clear());
  window.addEventListener('resize', () => positionCard(document.querySelector('.chef-presence-card'), active?.trigger));
  window.addEventListener('scroll', () => positionCard(document.querySelector('.chef-presence-card'), active?.trigger), true);

  return { activate, clear, getActive: () => active };
}
