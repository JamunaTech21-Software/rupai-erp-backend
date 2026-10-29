import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';
import { uploadRoot } from '../../src/modules/files/service.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** A placeholder PDF in the upload folder, registered like an upload (RP1-10). */
export async function placeholderPdf(db: Database, userId: string, name: string): Promise<string> {
  const id = newId();
  const storageKey = join('seed', `${id}.pdf`);
  await mkdir(join(uploadRoot(), 'seed'), { recursive: true });
  await writeFile(join(uploadRoot(), storageKey), PDF);
  await db.storedFile.create({
    data: { id, name, type: 'application/pdf', size: PDF.length, storageKey, createdBy: userId },
  });
  return id;
}

type Model =
  | 'division'
  | 'section'
  | 'fieldBlock'
  | 'landRecord'
  | 'landPayment'
  | 'landDocument'
  | 'nursery'
  | 'fieldPlanting'
  | 'employee'
  | 'worker'
  | 'contractor'
  | 'mouza';

/**
 * Adds one sample record unless a live record already matches `match` (its code within its parent), so
 * a re-seed never overwrites edits made in the dashboard. Writes the "create" edit-log row too. Returns
 * the record's id.
 */
export async function seedOne(
  db: Database,
  userId: string,
  model: Model,
  match: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<string> {
  const table = db[model] as unknown as {
    findFirst(args: object): Promise<{ id: string } | null>;
    create(args: object): Promise<unknown>;
  };
  const existing = await table.findFirst({ where: { ...match, deletedAt: null } });
  if (existing) return existing.id;
  const id = newId();
  await db.$transaction(async (tx) => {
    await (tx[model] as unknown as typeof table).create({
      data: { ...data, id, createdBy: userId, updatedBy: userId },
    });
    await writeHistory(tx, {
      resource: model,
      recordId: id,
      action: 'create',
      newData: { id, ...data },
      userId,
    });
  });
  return id;
}
