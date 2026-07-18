import { APP_BUILD_VERSION } from './constants.js';
import { STORAGE_KEYS } from './storage.js';

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_TYPE = 'gt-rota-builder-backup';

export const APP_OWNED_STORAGE_KEYS = [
  STORAGE_KEYS.schemaVersion,
  STORAGE_KEYS.appState,
  STORAGE_KEYS.history,
  'gtRota.mioEligibilityByChef',
  'gtRota.staffProfilesByChef'
];

const BACKUP_MIGRATIONS = {
  // Add one function per old schema here, keyed by the version it upgrades from.
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredValue(key, raw) {
  if (key === STORAGE_KEYS.schemaVersion) {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 0) {
      throw new Error('The stored data schema version is invalid.');
    }
    return version;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`The app data stored in “${key}” is not valid JSON.`);
  }
}

function validateAppState(value) {
  if (!isPlainObject(value)) throw new Error('The backup app state must be an object.');
  const checks = [
    ['staff', Array.isArray, 'an array'],
    ['settings', isPlainObject, 'an object'],
    ['weeklyInputs', isPlainObject, 'an object'],
    ['generatedRotas', isPlainObject, 'an object'],
    ['history', Array.isArray, 'an array'],
    ['uiState', isPlainObject, 'an object']
  ];
  checks.forEach(([field, predicate, expected]) => {
    if (Object.prototype.hasOwnProperty.call(value, field) && !predicate(value[field])) {
      throw new Error(`The backup app state field “${field}” must be ${expected}.`);
    }
  });
}

function validateData(data) {
  if (!isPlainObject(data)) throw new Error('The backup data must be an object.');
  const keys = Object.keys(data);
  if (!keys.length || !keys.some((key) => APP_OWNED_STORAGE_KEYS.includes(key))) {
    throw new Error('This file does not contain GT Rota Builder data.');
  }
  const unknownKey = keys.find((key) => !APP_OWNED_STORAGE_KEYS.includes(key));
  if (unknownKey) throw new Error(`The backup contains an unrecognised storage key: “${unknownKey}”.`);

  if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.schemaVersion)
    && (!Number.isInteger(data[STORAGE_KEYS.schemaVersion]) || data[STORAGE_KEYS.schemaVersion] < 0)) {
    throw new Error('The backup storage schema version is invalid.');
  }
  if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.appState)) {
    validateAppState(data[STORAGE_KEYS.appState]);
  }
  if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.history)
    && !Array.isArray(data[STORAGE_KEYS.history])) {
    throw new Error('The backup rota history must be an array.');
  }
  ['gtRota.mioEligibilityByChef', 'gtRota.staffProfilesByChef'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(data, key) && !isPlainObject(data[key])) {
      throw new Error(`The legacy backup data in “${key}” must be an object.`);
    }
  });
}

export function migrateBackup(backup) {
  let migrated = JSON.parse(JSON.stringify(backup));
  while (migrated.schemaVersion < BACKUP_SCHEMA_VERSION) {
    const migration = BACKUP_MIGRATIONS[migrated.schemaVersion];
    if (!migration) {
      throw new Error(`Backup schema ${migrated.schemaVersion} is too old and is not supported.`);
    }
    migrated = migration(migrated);
  }
  return migrated;
}

export function validateBackup(input) {
  let backup = input;
  if (typeof input === 'string') {
    if (!input.trim()) throw new Error('The selected backup file is empty.');
    try {
      backup = JSON.parse(input);
    } catch {
      throw new Error('The selected file is not valid JSON.');
    }
  }

  if (!isPlainObject(backup) || backup.backupType !== BACKUP_TYPE) {
    throw new Error('This is not a recognised GT Rota Builder backup.');
  }
  if (!Number.isInteger(backup.schemaVersion) || backup.schemaVersion < 1) {
    throw new Error('The backup schema version is missing or invalid.');
  }
  if (backup.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('This backup was created by a newer version of GT Rota Builder. Update the app before restoring it.');
  }
  if (typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt))) {
    throw new Error('The backup creation date is missing or invalid.');
  }

  const migrated = migrateBackup(backup);
  validateData(migrated.data);
  return migrated;
}

export function createBackup(storage = localStorage, now = new Date()) {
  const data = {};
  APP_OWNED_STORAGE_KEYS.forEach((key) => {
    const raw = storage.getItem(key);
    if (raw !== null) data[key] = parseStoredValue(key, raw);
  });
  validateData(data);
  return {
    backupType: BACKUP_TYPE,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    appVersion: APP_BUILD_VERSION,
    data
  };
}

export function serializeBackup(backup) {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function createBackupFilename(now = new Date()) {
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ];
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `gt-rota-backup-${parts.join('-')}-${time}.json`;
}

function serializeForStorage(key, value) {
  return key === STORAGE_KEYS.schemaVersion ? String(value) : JSON.stringify(value);
}

export async function restoreBackup(input, {
  storage = localStorage,
  confirmRestore = () => true
} = {}) {
  const backup = validateBackup(input);
  const confirmed = await confirmRestore(backup);
  if (!confirmed) return { restored: false, cancelled: true, backup };

  const currentData = new Map(APP_OWNED_STORAGE_KEYS.map((key) => [key, storage.getItem(key)]));
  const nextEntries = Object.entries(backup.data).map(([key, value]) => [key, serializeForStorage(key, value)]);

  try {
    APP_OWNED_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
    nextEntries.forEach(([key, value]) => storage.setItem(key, value));
  } catch (error) {
    try {
      APP_OWNED_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
      currentData.forEach((value, key) => {
        if (value !== null) storage.setItem(key, value);
      });
    } catch {
      throw new Error('Restore failed and the browser could not fully roll back its storage. Reload the page before making further changes.');
    }
    throw new Error(`Restore failed. Your existing data was kept unchanged. ${error?.message || ''}`.trim());
  }

  return { restored: true, cancelled: false, backup };
}
