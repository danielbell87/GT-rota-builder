import { parseLocalDate } from './utils.js';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function inclusiveDays(start, finish) {
  const startDate = parseLocalDate(start);
  const finishDate = parseLocalDate(finish);
  return Math.round((finishDate - startDate) / 86400000) + 1;
}

function coversDate(entry, date) {
  const start = entry?.startDate || entry?.date;
  const finish = entry?.finishDate || entry?.date || start;
  return !!start && !!finish && date >= start && date <= finish;
}

export function normalizeManualDailyNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([date, note]) => [date, cleanText(note)])
    .filter(([date, note]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && note));
}

export function composeDateNotes(date, inputs = {}) {
  const lines = [];
  const request = (inputs.additionalChefRequirements || []).find((entry) => entry?.date === date);
  if (request && Number(request.count) > 0) {
    const count = Number(request.count);
    const reason = cleanText(request.note);
    lines.push({
      type: 'additional',
      text: `${count} additional chef${count === 1 ? '' : 's'} required${reason ? `: ${reason}` : ''}`
    });
  }

  (inputs.availability || []).filter((entry) => coversDate(entry, date)).forEach((entry) => {
    const chef = cleanText(entry.chef);
    if (!chef) return;
    if (entry.type === 'Annual Leave') {
      const start = entry.startDate || entry.date;
      const finish = entry.finishDate || entry.date || start;
      const day = inclusiveDays(start, date);
      const total = inclusiveDays(start, finish);
      lines.push({ type: 'holiday', text: `${chef} on holiday, day ${day} of ${total}` });
    } else if (entry.type === 'Unavailable') {
      lines.push({ type: 'unavailable', text: `${chef} unavailable` });
    }
  });

  const manual = cleanText(inputs.manualDailyNotes?.[date]);
  if (manual) lines.push({ type: 'manual', text: manual });
  return lines;
}
