import { optEmail, optText, optUrl } from '../../lib/fields.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-194 P.5: the contact details shared by Association Setup and Regulatory Authority Setup. All optional:
 * an empty value clears the field, and a field the body leaves out keeps its saved value (the page before
 * RP1-195 does not send them). The phone is free text (an office landline such as +880-31-2858421, or a
 * mobile), so it only checks the characters.
 */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const contactSchema = {
  contactPerson: optText(120).optional(),
  designation: optText(80).optional(),
  phone: z
    .preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(30, 'At most 30 characters.')
        .regex(/^\+?[0-9][0-9 ()-]{4,}$/, 'Enter a valid phone number (digits, +, -, spaces).')
        .nullable(),
    )
    .optional(),
  email: optEmail().optional(),
  website: optUrl().optional(),
  address: optText(500).optional(),
};

/** Search box: also by contact person, phone and email. */
export const contactSearch = ['contactPerson', 'phone', 'email'];

type Row = Record<string, unknown>;
/** The six export columns, after Short Name. */
export const contactColumns = [
  { header: 'Contact Person', value: (row: Row) => row.contactPerson, width: 24 },
  { header: 'Designation', value: (row: Row) => row.designation, width: 20 },
  { header: 'Phone', value: (row: Row) => row.phone, width: 18 },
  { header: 'Email', value: (row: Row) => row.email, width: 28 },
  { header: 'Website', value: (row: Row) => row.website, width: 30 },
  { header: 'Address', value: (row: Row) => row.address, width: 40 },
];
