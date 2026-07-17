import { EDITABLE_SKILL_SECTIONS } from './constants.js';

export const SECTION_LEVELS = {
  SHOULD_NOT_COVER: 0,
  IN_TRAINING: 1,
  COMPETENT: 2,
  PREFERRED: 3
};

export const SECTION_LEVEL_LABELS = {
  [SECTION_LEVELS.SHOULD_NOT_COVER]: 'Should not cover',
  [SECTION_LEVELS.IN_TRAINING]: 'In training',
  [SECTION_LEVELS.COMPETENT]: 'Competent',
  [SECTION_LEVELS.PREFERRED]: 'Preferred'
};

export const SECTION_LEVEL_OPTIONS = Object.values(SECTION_LEVELS).map((value) => ({
  value,
  label: SECTION_LEVEL_LABELS[value]
}));

export function parseSectionLevel(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
  }
  if (typeof value === 'string' && /^[0-3]$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
}

export function normalizeSectionLevel(value) {
  return parseSectionLevel(value) ?? SECTION_LEVELS.SHOULD_NOT_COVER;
}

export function normalizeSectionSkills(skills = {}) {
  const normalized = {};
  EDITABLE_SKILL_SECTIONS.forEach((section) => {
    normalized[section] = normalizeSectionLevel(skills?.[section] ?? 0);
  });

  Object.entries(skills || {}).forEach(([section, value]) => {
    if (!(section in normalized)) normalized[section] = normalizeSectionLevel(value);
  });

  return normalized;
}

export function getSectionLevel(chef, section) {
  return normalizeSectionLevel(chef?.sectionSkills?.[section] ?? chef?.skills?.[section] ?? 0);
}

export function getSectionLevelLabel(value) {
  return SECTION_LEVEL_LABELS[normalizeSectionLevel(value)] || SECTION_LEVEL_LABELS[SECTION_LEVELS.SHOULD_NOT_COVER];
}

export function canCoverSection(chef, section) {
  return getSectionLevel(chef, section) > SECTION_LEVELS.SHOULD_NOT_COVER;
}

export function sectionCandidateScore(chef, section) {
  switch (getSectionLevel(chef, section)) {
    case SECTION_LEVELS.PREFERRED:
      return 30;
    case SECTION_LEVELS.COMPETENT:
      return 20;
    case SECTION_LEVELS.IN_TRAINING:
      return 8;
    default:
      return Number.NEGATIVE_INFINITY;
  }
}
