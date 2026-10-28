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

const numberError = (issue: { input?: unknown }) =>
  issue.input === null || issue.input === undefined ? 'This field is required.' : 'Must be a number.';
const number = (negative = 'Must be 0 or more.') => z.number({ error: numberError }).min(0, negative);
/** Required number (area, count, amount), 0 or more; `negative` is the page's own message. */
export const num = (negative?: string) => z.preprocess(toNumber, number(negative));
/** Optional number, 0 or more. */
export const optNum = (negative?: string) => z.preprocess(toNumber, number(negative).nullable());
/** Optional number that may be negative (latitude, longitude). */
export const optCoord = () => z.preprocess(toNumber, z.number({ error: numberError }).nullable());
/** Required latitude (-90 to 90) or longitude (-180 to 180). */
export const coord = (limit: 90 | 180) =>
  z.preprocess(
    toNumber,
    z
      .number({ error: numberError })
      .min(-limit, `Must be -${limit} or more.`)
      .max(limit, `Must be ${limit} or less.`),
  );
/** Optional whole number (year, count). */
export const optInt = (negative?: string) =>
  z.preprocess(toNumber, number(negative).int('Must be a whole number.').nullable());
export const int = (negative?: string) =>
  z.preprocess(toNumber, number(negative).int('Must be a whole number.'));

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
export const reqDate = () => z.preprocess(blankToNull, date);
export const optDate = () => z.preprocess(blankToNull, date.nullable());

/** A fixed dropdown: the prototype option's `value`. */
export const option = () => text(60);
export const optOption = () => optText(60);
/** A fixed dropdown limited to the prototype's values. */
export const oneOf = (values: readonly string[]) =>
  option().refine((v) => values.includes(v), 'Select a value from the list.');
/** Optional fixed dropdown limited to the prototype's values. */
export const optOneOf = (values: readonly string[]) =>
  optOption().refine((v) => v === null || values.includes(v), 'Select a value from the list.');

/** Required text in a fixed format (codes such as DIV-01); `example` is the page's own message. */
export const code = (pattern: RegExp, example: string) => text(60).regex(pattern, example);

/** Multi-select or a list of file ids. */
export const list = () =>
  z.preprocess(
    // A checkbox group with nothing ticked sends false.
    (v) => (v === '' || v === null || v === undefined || v === false ? [] : v),
    z.array(z.string().trim().min(1)),
  );

/** Optional Bangladesh mobile number, as the dashboard checks it: +8801XXXXXXXXX or 01XXXXXXXXX. */
export const optPhone = () =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^(\+8801|01)[3-9]\d{8}$/, 'Enter a valid phone number')
      .nullable(),
  );

/** Optional e-mail address. */
export const optEmail = () =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(160)
      .regex(/^\S+@\S+\.\S+$/, 'Enter a valid email')
      .nullable(),
  );

/** Optional web address (http or https). */
export const optUrl = () =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(255)
      .regex(/^https?:\/\/\S+$/, 'Enter a valid web address (https://…)')
      .nullable(),
  );

/** Yes/no; accepts true/false and "true"/"false". */
export const bool = () =>
  z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v === '' || v === undefined ? null : v),
    z.boolean().nullable(),
  );

/** The id of another record (estate, division, …). Existence is checked by the resource (refs). */
export const ref = () =>
  z.string({ error: 'This field is required.' }).trim().length(26, 'Select a value from the list.');
export const optRef = () =>
  z.preprocess(blankToNull, z.string().trim().length(26, 'Select a value from the list.').nullable());

/** One uploaded file id (RP1-10). */
export const fileId = () => optText(26);

/**
 * A boundary as the dashboard's map draws it (react-leaflet `<Polygon positions>`): a list of
 * [latitude, longitude] points, at least 3. Optional.
 */
export const polygon = () =>
  z.preprocess(
    blankToNull,
    z
      .array(
        z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)], {
          error: 'Each point is [latitude, longitude].',
        }),
      )
      .min(3, 'A boundary needs at least 3 points.')
      .nullable(),
  );

/** Free-form structured value (GeoJSON boundary). */
export const geojson = () => z.preprocess(blankToNull, z.record(z.string(), z.unknown()).nullable());
