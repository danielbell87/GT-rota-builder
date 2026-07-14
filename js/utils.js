import { WEEKDAYS } from './constants.js';

export function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
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
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

export function getDayName(dateStr) {
  const d = parseLocalDate(dateStr);
  return WEEKDAYS[d.getDay()];
}
