/** Minimum age (in whole years) required to hold a dating profile. */
export const MIN_DATING_AGE = 18;
/** Upper sanity bound for date of birth. */
export const MAX_DATING_AGE = 100;

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 500;
export const OCCUPATION_MAX = 100;
export const EDUCATION_MAX = 100;
export const PLACE_NAME_MAX = 100;

/** Coordinates are rounded before storage (3 dp ≈ 110 m) to limit precision retained. */
export const COORDINATE_DECIMALS = 3;
