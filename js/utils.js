import { WEEKDAYS } from './constants.js';

export function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

export function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatWeekCommencing(dateStr) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  const monday = new Date(d);
  const diff = (day + 6) % 7;
  monday.setDate(d.getDate() - diff);
  return monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function normalizeWeekStart(dateStr) {
  const d = parseLocalDate(dateStr);
  const monday = new Date(d);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  monday.setDate(d.getDate() - diff);
  return formatIsoDate(monday);
}

export function getDayName(dateStr) {
  const d = parseLocalDate(dateStr);
  return WEEKDAYS[d.getDay()];
}

export function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

export function getPlanningWeekStarts(weekStart, numWeeks = 1) {
  const weeks = Math.max(1, Math.min(8, Number(numWeeks) || 1));
  return Array.from({ length: weeks }, (_, index) => addDays(weekStart, index * 7));
}

export function getPlanningHorizon(weekStart, numWeeks = 1) {
  const normalizedWeekStart = normalizeWeekStart(weekStart);
  const weekStarts = getPlanningWeekStarts(normalizedWeekStart, numWeeks);
  const endDate = parseLocalDate(weekStarts[weekStarts.length - 1]);
  endDate.setDate(endDate.getDate() + 6);
  return {
    startDate: normalizedWeekStart,
    endDate: formatIsoDate(endDate),
    weekStarts
  };
}
