import { DISPLAY_SECTIONS } from './constants.js';
import { formatDate, formatWeekCommencing } from './utils.js';

const PATHS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>', warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  success: '<path d="m5 12 4 4L19 6"/>', previous: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>', undo: '<path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  print: '<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
  regenerate: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 11a7 7 0 0 0-12-4L4 9m2 4a7 7 0 0 0 12 4l2-2"/>',
  reset: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', published: '<path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-5"/>',
  expand: '<path d="m6 9 6 6 6-6"/>'
};

export function icon(name, className = 'ui-icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export function getWeekLifecycle(state, weekIndex) {
  const week = state.generatedRotas.latestResult?.weeks?.[weekIndex];
  if (!week) return 'Generated';
  const prefix = `${week.weekStart}__`;
  const edited = Object.keys(state.manualEditing?.edits || {}).some((key) => key.startsWith(prefix));
  if (edited) return 'Manually adjusted';
  return (state.history || []).some((entry) => entry.weekStart === week.weekStart) ? 'Published' : 'Generated';
}

export function buildWeekClipboardText({ state, overallResult, weekIndex = 0 }) {
  const week = overallResult?.weeks?.[weekIndex];
  if (!week) return '';
  const lines = ['GT Rota', formatWeekCommencing(week.weekStart), ''];
  const hardIssues = (week.hardValidation || []).filter((item) => item.severity === 'hard' && item.passed === false);
  if (week.status !== 'ok' || hardIssues.length) lines.push('Draft rota: unresolved rule issues');
  if (getWeekLifecycle(state, weekIndex) === 'Manually adjusted') lines.push('Manually adjusted');
  if (lines.at(-1) !== '') lines.push('');
  (week.rota || []).forEach((day, dayIndex) => {
    lines.push(`${day.dayName} ${formatDate(day.date)}`);
    DISPLAY_SECTIONS.forEach((section) => {
      const chefs = day.assignments.filter((item) => item.section === section).map((item) => item.chef).filter(Boolean);
      lines.push(`${section}:${chefs.length ? ` ${chefs.join(', ')}` : ''}`);
    });
    if (dayIndex < week.rota.length - 1) lines.push('');
  });
  return lines.join('\n');
}
