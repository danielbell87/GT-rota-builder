export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CORE_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'];
export const DISPLAY_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry', 'Float', 'Breakfast', 'MIO'];
export const EDITABLE_SKILL_SECTIONS = ['Pass', 'Sauce', 'Garnish', 'Larder', 'Pastry'];

export const APP_BUILD_VERSION = '2026.07.18.4';
export const CACHE_BUST_VERSION = '20260718e';
export const DAY_FAIRNESS_WEIGHTS = {
  Monday: 0,
  Tuesday: 0,
  Wednesday: 1,
  Thursday: 1,
  Friday: 3,
  Saturday: 4,
  Sunday: 4
};

export const CHEF_ROLES = ['Executive Chef', 'Head Chef', 'Sous Chef', 'Chef de Partie', 'Demi Chef de Partie', 'Commis Chef'];

export const MIO_SEQUENCE = {
  primary: ['Monday', 'Tuesday', 'Wednesday'],
  fallback: ['Thursday', 'Friday'],
  forbidden: ['Saturday', 'Sunday']
};

export const SHIFT_LENGTHS = {
  regularByDay: {
    Monday: 11.5,
    Tuesday: 11.5,
    Wednesday: 12.5,
    Thursday: 12.5,
    Friday: 12.5,
    Saturday: 12.5,
    Sunday: 10.5
  },
  mio: 8.5,
  annualLeaveCreditPerDay: 12
};

export const TARGET_HOURS = {
  weekly: 48,
  tolerance: 2
};

export const SCORING_WEIGHTS = {
  preferredSection: 4,
  proficientSection: 2,
  trainingSection: 1,
  avoidedSectionPenalty: -5,
  weekendFairnessPenalty: -2,
  breakfastFairnessPenalty: -2,
  preferredBreakfastDayBonus: 3,
  twoConsecutiveDaysOffBonus: 2,
  seniorDistributionBonus: 2
};

export const STATUS_VALUES = ['Draft', 'Ready for AI', 'Published'];
