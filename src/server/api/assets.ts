// src/server/api/assets.ts
// POST /api/assets   — upload an image file; saves to pages/_assets/, returns { url }
// GET  /assets/:file — static serve from pages/_assets/ (registered via express.static)
//
// Path traversal is prevented by multer's filename filter + basename check.

import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import type { ServerContext } from '../context.js';
import { badRequest, notFound } from '../utils/errorResponse.js';

const ALLOWED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico',
]);

const ALLOWED_MIMETYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon',
]);

/** Explicit Content-Type map prevents MIME-sniffing attacks on served assets. */
const ASSET_MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp':  'image/bmp',
  '.ico':  'image/x-icon',
};

/**
 * Registers the assets API:
 *   POST /api/assets  — upload an image to `pages/_assets/`; returns `{ url }`.
 *   GET  /assets/:file — serve uploaded images (registered via `express.static`).
 *
 * Only image MIME types and extensions are accepted; path traversal is prevented
 * by multer's filename filter combined with a basename check.
 */
export function registerAssetsApi(app: Express, ctx: ServerContext): void {
  const assetsDir = join(ctx.cwd, ctx.config.pages_dir, '_assets');
  mkdirSync(assetsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetsDir),
    filename: (_req, file, cb) => {
      // Sanitise filename: keep base + ext, prefix with timestamp to avoid collisions
      const safe = basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = extname(safe).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) {
        return cb(new Error(`File type not allowed: ${ext}`), '');
      }
      const name = `${Date.now()}_${safe}`;
      cb(null, name);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) { cb(null, false); return; }
      if (!ALLOWED_MIMETYPES.has(file.mimetype)) { cb(new Error('Invalid MIME type')); return; }
      cb(null, true);
    },
  });

  // POST /api/assets — upload one image
  app.post(
    '/api/assets',
    upload.single('file'),
    (req: Request, res: Response) => {
      if (!req.file) {
        return badRequest(res, 'No file uploaded or file type not allowed');
      }
      const url = `/assets/${req.file.filename}`;
      res.status(201).json({ url, filename: req.file.filename });
    },
  );

  // Serve uploaded assets at /assets/*
  // Check that the resolved path stays within assetsDir (path traversal guard)
  app.get('/assets/:filename', (req: Request, res: Response) => {
    const filename = basename(String(req.params['filename'] ?? ''));
    if (!filename) return badRequest(res, 'Invalid filename');
    const filePath = join(assetsDir, filename);
    if (!existsSync(filePath)) return notFound(res, 'Not found');
    // Explicitly set Content-Type and prevent MIME sniffing (S08)
    res.setHeader('Content-Type', ASSET_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  });
}
