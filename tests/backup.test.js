import {
  APP_OWNED_STORAGE_KEYS,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TYPE,
  createBackup,
  createBackupFilename,
  restoreBackup,
  serializeBackup,
  validateBackup
} from '../js/backup.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.failOnKey = '';
    this.hasFailed = false;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failOnKey && !this.hasFailed) {
      this.hasFailed = true;
      throw new Error('Simulated storage failure');
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function validStoredState(name = 'Backup Chef') {
  return {
    'gtRota.schemaVersion': '12',
    'gtRota.state.v2': JSON.stringify({
      staff: [{
        id: 'chef-backup',
        name,
        role: 'Sous Chef',
        skills: { Pass: 3, Sauce: 2, Garnish: 2, Larder: 1, Pastry: 0 },
        preferredDaysOff: ['Monday'],
        preferredBreakfast: 'Sunday',
        breakfastEligible: true,
        mioEligible: true
      }],
      settings: { rules: [{ id: 'rule-1', enabled: true }] },
      weeklyInputs: {
        weekStart: '2026-07-20',
        numWeeks: 2,
        availability: [{ chef: name, type: 'Unavailable', startDate: '2026-07-21', finishDate: '2026-07-21' }],
        weeklyMioSelections: { '2026-07-20': name }
      },
      generatedRotas: { current: { status: 'ok' }, latestResult: { status: 'ok' } },
      history: [{ chef: name, breakfasts: 2, fridayWorked: true, saturdayWorked: false, sundayWorked: true }],
      uiState: { selectedResultWeekIndex: 1 }
    }),
    'gtRota.history.v1': JSON.stringify([{
      chef: name,
      breakfasts: 3,
      fridayWorked: true,
      saturdayWorked: true,
      sundayWorked: false,
      latestWeekendBlock: 'fri-sat'
    }])
  };
}

function throwsMessage(callback) {
  try {
    callback();
    return '';
  } catch (error) {
    return error.message;
  }
}

export async function runBackupTests(assert) {
  const source = new MemoryStorage({
    ...validStoredState(),
    'gtRota.mioEligibilityByChef': JSON.stringify({ 'Backup Chef': true }),
    unrelatedPreference: JSON.stringify({ theme: 'blue' })
  });
  const createdAt = new Date('2026-07-18T17:25:00.000Z');
  const backup = createBackup(source, createdAt);

  assert(
    APP_OWNED_STORAGE_KEYS.every((key) => !source.getItem(key) || Object.prototype.hasOwnProperty.call(backup.data, key)),
    'Backup: export includes every present app-owned storage key'
  );
  assert(
    !Object.prototype.hasOwnProperty.call(backup.data, 'unrelatedPreference'),
    'Backup: export excludes unrelated localStorage entries'
  );
  assert(
    backup.backupType === BACKUP_TYPE
      && backup.schemaVersion === BACKUP_SCHEMA_VERSION
      && backup.createdAt === createdAt.toISOString()
      && typeof backup.appVersion === 'string',
    'Backup: metadata includes recognised type, schema, creation time, and app version'
  );
  assert(
    serializeBackup(backup).includes('\n  "data": {')
      && createBackupFilename(new Date(2026, 6, 18, 18, 25)) === 'gt-rota-backup-2026-07-18-1825.json',
    'Backup: JSON is human-readable and filename uses local date and time'
  );

  const target = new MemoryStorage(validStoredState('Current Chef'));
  let confirmCalls = 0;
  const result = await restoreBackup(serializeBackup(backup), {
    storage: target,
    confirmRestore: () => {
      confirmCalls += 1;
      return true;
    }
  });
  const restoredState = JSON.parse(target.getItem('gtRota.state.v2'));
  const restoredHistory = JSON.parse(target.getItem('gtRota.history.v1'));
  assert(
    result.restored && confirmCalls === 1 && restoredState.staff[0].name === 'Backup Chef',
    'Backup: valid backup restores after confirmation'
  );
  assert(
    restoredState.history[0].breakfasts === 2
      && restoredHistory[0].latestWeekendBlock === 'fri-sat'
      && restoredHistory[0].breakfasts === 3,
    'Backup: fairness, weekend, breakfast, and rotation history restore correctly'
  );

  const invalidJsonMessage = throwsMessage(() => validateBackup('{invalid'));
  assert(invalidJsonMessage.includes('not valid JSON'), 'Backup: invalid JSON is rejected with a useful message');
  const unrelatedMessage = throwsMessage(() => validateBackup(JSON.stringify({ hello: 'world' })));
  assert(unrelatedMessage.includes('not a recognised'), 'Backup: unrelated JSON is rejected');
  const newerMessage = throwsMessage(() => validateBackup(JSON.stringify({
    ...backup,
    schemaVersion: BACKUP_SCHEMA_VERSION + 1
  })));
  assert(newerMessage.includes('newer version'), 'Backup: unsupported newer schema explains the compatibility problem');

  const cancelledTarget = new MemoryStorage(validStoredState('Keep Me'));
  const beforeCancel = JSON.stringify(Object.fromEntries(cancelledTarget.values));
  const cancelled = await restoreBackup(backup, {
    storage: cancelledTarget,
    confirmRestore: () => false
  });
  assert(
    cancelled.cancelled && JSON.stringify(Object.fromEntries(cancelledTarget.values)) === beforeCancel,
    'Backup: current data is replaced only after confirmation'
  );

  const failingTarget = new MemoryStorage(validStoredState('Rollback Chef'));
  const beforeFailure = JSON.stringify(Object.fromEntries(failingTarget.values));
  failingTarget.failOnKey = 'gtRota.history.v1';
  let restoreFailure = '';
  try {
    await restoreBackup(backup, { storage: failingTarget, confirmRestore: () => true });
  } catch (error) {
    restoreFailure = error.message;
  }
  assert(
    restoreFailure.includes('kept unchanged')
      && JSON.stringify(Object.fromEntries(failingTarget.values)) === beforeFailure,
    'Backup: failed restoration rolls back all current app data'
  );

  const malformed = JSON.parse(serializeBackup(backup));
  malformed.data['gtRota.state.v2'].staff = {};
  const malformedTarget = new MemoryStorage(validStoredState('Unchanged Chef'));
  const beforeMalformed = JSON.stringify(Object.fromEntries(malformedTarget.values));
  let malformedMessage = '';
  try {
    await restoreBackup(malformed, { storage: malformedTarget, confirmRestore: () => true });
  } catch (error) {
    malformedMessage = error.message;
  }
  assert(
    malformedMessage.includes('staff') && JSON.stringify(Object.fromEntries(malformedTarget.values)) === beforeMalformed,
    'Backup: entire structure is validated before any existing data changes'
  );
}
