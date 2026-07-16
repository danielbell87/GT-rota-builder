export function normalizeHistoryKey(weekStart) {
  return `week__${weekStart}`;
}

export function upsertPublishedHistory(state, weekRecord) {
  if (state.weeklyInputs.status !== 'Published') return { updated: 0, inserted: 0 };

  const nextHistory = state.history.slice();
  let updated = 0;
  let inserted = 0;
  const key = normalizeHistoryKey(weekRecord.weekStart);
  const record = {
    key,
    kind: 'published-week',
    weekStart: weekRecord.weekStart,
    mioChef: weekRecord.mioChef || '',
    rota: weekRecord.rota || [],
    summary: weekRecord.summary || [],
    validation: weekRecord.validation || {},
    fairnessAttendance: weekRecord.fairnessSummary || [],
    status: weekRecord.status || 'ok',
    publishedAt: new Date().toISOString()
  };

  const index = nextHistory.findIndex((entry) => entry.key === key);
  if (index >= 0) {
    nextHistory[index] = { ...nextHistory[index], ...record };
    updated += 1;
  } else {
    nextHistory.push(record);
    inserted += 1;
  }

  state.history = nextHistory;
  return { updated, inserted };
}
