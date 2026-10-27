import { z } from './validation.js';

/**
 * Field types for the page forms (plan.md §3). The dashboard sends what its inputs hold, so these are
 * forgiving: an empty string means "not filled", and a number may come as "12.5".
 */
const blankToNull = (value: unknown) => (value === '' || value === undefined ? null : value);
const toNumber = (value: unknown) => {
  const v = blankToNull(value);
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Required text. */
export const text = (max = 255) =>
  z
    .string({ error: 'This field is required.' })
    .trim()
    .min(1, 'This field is required.')
    .max(max, `At most ${max} characters.`);

/** Optional text: "" and missing become null. */
export const optText = (max = 255) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `At most ${max} characters.`).nullable());

/** Long optional text (descriptions, remarks, addresses). */
export const longText = () => optText(5000);

const number = z.number({ error: 'Must be a number.' }).min(0, 'Must be 0 or more.');
/** Required number (area, count, amount). */
export const num = () => z.preprocess(toNumber, number);
/** Optional number. */
export const optNum = () => z.preprocess(toNumber, number.nullable());
/** Optional number that may be negative (latitude, longitude). */
export const optCoord = () => z.preprocess(toNumber, z.number({ error: 'Must be a number.' }).nullable());
/** Optional whole number (year, count). */
export const optInt = () => z.preprocess(toNumber, number.int('Must be a whole number.').nullable());
export const int = () => z.preprocess(toNumber, number.int('Must be a whole number.'));

/** `YYYY-MM-DD` → Date (stored as a date). */
const date = z
  .string({ error: 'This field is required.' })
  .regex(DATE, 'Use the format YYYY-MM-DD.')
  .transform((v, ctx) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: 'custom', message: 'Not a valid date.' });
      return z.NEVER;
    }
    return d;
  });
export const reqDate = () => date;
export const optDate = () => z.preprocess(blankToNull, date.nullable());

/** A fixed dropdown: the prototype option's `value`. */
export const option = () => text(60);
export const optOption = () => optText(60);

/** Multi-select or a list of file ids. */
export const list = () =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? [] : v),
    z.array(z.string().trim().min(1)),
  );

/** Yes/no; accepts true/false and "true"/"false". */
export const bool = () =>
  z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v === '' ? null : v),
    z.boolean().nullable(),
  );

/** The id of another record (estate, division, …). Existence is checked by the resource (refs). */
export const ref = () =>
  z.string({ error: 'This field is required.' }).trim().length(26, 'Select a value from the list.');
export const optRef = () =>
  z.preprocess(blankToNull, z.string().trim().length(26, 'Select a value from the list.').nullable());

/** One uploaded file id (RP1-10). */
export const fileId = () => optText(26);

/** Free-form structured value (GeoJSON boundary). */
export const geojson = () => z.preprocess(blankToNull, z.record(z.string(), z.unknown()).nullable());
