import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { config } from '../../config/env.js';
import { db } from '../../lib/db.js';

/** What may be uploaded (RP1-10): photos and scans, and PDF documents. */
export const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/** First bytes of each allowed type, so a renamed file of another kind is refused. */
export function sniffType(head: Buffer): string | undefined {
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return undefined;
}

export const uploadRoot = () => resolve(config.UPLOAD_DIR);

/** Moves a finished temporary upload into place and records it. */
export async function storeFile(input: {
  id: string;
  tempPath: string;
  name: string;
  type: string;
  size: number;
  userId: string;
}) {
  const now = new Date();
  const dir = join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const storageKey = join(dir, `${input.id}${ALLOWED_TYPES[input.type] ?? extname(input.name)}`);
  await mkdir(join(uploadRoot(), dir), { recursive: true });
  await rename(input.tempPath, join(uploadRoot(), storageKey));
  return db.storedFile.create({
    data: {
      id: input.id,
      name: input.name,
      type: input.type,
      size: input.size,
      storageKey,
      createdBy: input.userId,
    },
  });
}

export const removeTemp = (path: string) => rm(path, { force: true });

const signature = (id: string) =>
  createHmac('sha256', config.JWT_SECRET).update(`file:${id}`).digest('base64url').slice(0, 32);

/** A link that works in `<img src>` without the login token: signed with the server secret. */
export const fileUrl = (id: string) =>
  `${config.PUBLIC_URL.replace(/\/$/, '')}/api/v1/files/${id}/content?sig=${signature(id)}`;

export function validSignature(id: string, sig: unknown): boolean {
  if (typeof sig !== 'string') return false;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const openFile = (storageKey: string) => createReadStream(join(uploadRoot(), storageKey));

export const describe = (f: { id: string; name: string; size: number; type: string }) => ({
  id: f.id,
  url: fileUrl(f.id),
  name: f.name,
  size: f.size,
  type: f.type,
});
