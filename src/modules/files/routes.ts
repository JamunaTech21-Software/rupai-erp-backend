import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import busboy from 'busboy';
import { type Request, type Response, Router } from 'express';

import { config } from '../../config/env.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { currentUserId } from '../../lib/resource.js';
import {
  ALLOWED_TYPES,
  describe,
  openFile,
  removeTemp,
  sniffType,
  storeFile,
  uploadRoot,
  validSignature,
} from './service.js';

const refuse = (message: string) => new AppError('VALIDATION', message, { file: message });

interface Received {
  tempPath: string;
  name: string;
  type: string;
  size: number;
}

/** Reads one multipart field `file` to a temporary file, checking size and real type as it streams. */
function receive(req: Request): Promise<Received> {
  const maxBytes = config.MAX_UPLOAD_MB * 1024 * 1024;
  return new Promise((resolvePromise, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes } });
    } catch {
      reject(refuse('Choose a file to upload.'));
      return;
    }
    let found = false;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || found) {
        stream.resume();
        return;
      }
      found = true;
      const tempPath = join(uploadRoot(), 'tmp', `${newId()}.part`);
      let size = 0;
      let head = Buffer.alloc(0);
      let tooBig = false;
      void mkdir(join(uploadRoot(), 'tmp'), { recursive: true }).then(() => {
        const out = createWriteStream(tempPath);
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        });
        stream.on('limit', () => {
          tooBig = true;
        });
        stream.pipe(out);
        out.on('finish', () => {
          if (tooBig) {
            void removeTemp(tempPath);
            reject(refuse(`The file is larger than ${config.MAX_UPLOAD_MB} MB.`));
            return;
          }
          const type = sniffType(head);
          if (!type || !ALLOWED_TYPES[type]) {
            void removeTemp(tempPath);
            reject(refuse('Only JPG, PNG, WebP images and PDF files can be uploaded.'));
            return;
          }
          if (size === 0) {
            void removeTemp(tempPath);
            reject(refuse('The file is empty.'));
            return;
          }
          resolvePromise({ tempPath, name: info.filename || 'file', type, size });
        });
        out.on('error', reject);
      }, reject);
    });
    parser.on('close', () => {
      if (!found) reject(refuse('Choose a file to upload.'));
    });
    parser.on('error', () => reject(refuse('The upload could not be read.')));
    req.pipe(parser);
  });
}

/** RP1-10: upload (signed-in) and view/download. */
export const filesRouter = Router();

filesRouter.post('/', async (req, res) => {
  const userId = currentUserId(req);
  const file = await receive(req);
  const stored = await storeFile({ id: newId(), userId, ...file });
  res.status(201).json(describe(stored));
});

filesRouter.get('/:id', async (req, res) => {
  const file = await db.storedFile.findUnique({ where: { id: req.params.id } });
  if (!file) throw notFound('File');
  res.json(describe(file));
});

/** The file itself. Public, but only with the signature from `url`, so `<img src>` works. */
export async function sendFileContent(req: Request<{ id: string }>, res: Response) {
  if (!validSignature(req.params.id, req.query.sig)) throw notFound('File');
  const file = await db.storedFile.findUnique({ where: { id: req.params.id } });
  if (!file) throw notFound('File');
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader(
    'Content-Disposition',
    `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(file.name)}"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  openFile(file.storageKey)
    .on('error', () => res.destroy())
    .pipe(res);
}
