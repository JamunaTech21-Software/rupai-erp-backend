import { optText, ref, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-54 Mouza list per estate, for the Mouza select on Land & Lease Management (`/options/mouzas?estate=`).
 * There is no page for it in the design yet, so it is managed through the API. The name is unique within its
 * estate; a land record may only pick a mouza of its own estate.
 */
const mouzaSchema = z.object({
  estate: ref(),
  mouzaName: text(120),
  jlNo: optText(60),
  remarks: optText(1000),
});

export const mouzasRouter = defineResource('/mouzas', {
  name: 'mouza',
  label: 'Mouza',
  model: 'mouza',
  schema: mouzaSchema,
  search: ['mouzaName', 'jlNo'],
  filters: ['estate'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  unique: [{ field: 'mouzaName', scope: ['estate'] }],
  orderBy: { mouzaName: 'asc' },
  options: { path: 'mouzas', label: (row) => String(row.mouzaName), filters: ['estate'] },
});
