import { WEEKDAYS } from './constants.js';

export function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

export function toDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, days) {
  const date = typeof dateStr === 'string' ? parseLocalDate(dateStr) : new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date;
}

export function advanceDateString(dateStr, days) {
  return toDateString(addDays(dateStr, days));
}

export function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatWeekCommencing(dateStr) {
  const d = parseLocalDate(normalizeWeekStart(dateStr));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function normalizeWeekStart(dateStr) {
  const d = parseLocalDate(dateStr);
  const monday = new Date(d);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  monday.setDate(d.getDate() - diff);
  return toDateString(monday);
}

export function getWeekStartAtOffset(weekStart, weekIndex) {
  return advanceDateString(normalizeWeekStart(weekStart), weekIndex * 7);
}

export function getPlanningHorizon(weekStart, numWeeks = 1) {
  const normalizedWeekStart = normalizeWeekStart(weekStart);
  const clampedWeeks = Math.max(1, Math.min(8, Number.parseInt(numWeeks, 10) || 1));
  const end = advanceDateString(normalizedWeekStart, (clampedWeeks * 7) - 1);
  return {
    start: normalizedWeekStart,
    end,
    weeks: clampedWeeks,
    startDate: parseLocalDate(normalizedWeekStart),
    endDate: parseLocalDate(end)
  };
}

export function isDateWithinRange(dateStr, start, end) {
  const current = parseLocalDate(dateStr);
  return current >= parseLocalDate(start) && current <= parseLocalDate(end);
}

export function formatCompactWeekRange(weekStart) {
  const start = parseLocalDate(normalizeWeekStart(weekStart));
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const endLabel = end.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long' });
  if (sameMonth) {
    return `${start.getDate()}-${end.getDate()} ${end.toLocaleDateString('en-GB', { month: 'long' })}`;
  }
  return `${startLabel}-${endLabel}`;
}

export function formatPlanningHorizonLabel(weekStart, numWeeks = 1) {
  const horizon = getPlanningHorizon(weekStart, numWeeks);
  return `${formatDate(horizon.start)} – ${formatDate(horizon.end)}`;
}

export function getDayName(dateStr) {
  const d = parseLocalDate(dateStr);
  return WEEKDAYS[d.getDay()];
}
