# CI / Workflow / Developer Experience Audit

> Generated 2026-03-05. Files reviewed: `.github/workflows/ci.yml`, `package.json`,
> `vitest.config.ts`, `playwright.config.ts`, `vite.config.ts`, `.gitignore`,
> `tsconfig.json`, `tsconfig.client.json`, `tsconfig.test.json`.

---

## CRITICAL

### C-01 · Client TypeScript is never type-checked in CI

|              |                                                   |
| ------------ | ------------------------------------------------- |
| **File**     | `.github/workflows/ci.yml` → `lint-typecheck` job |
| **Location** | `ci.yml` line 24 – `npm run typecheck`            |

**Issue.** `npm run typecheck` runs `tsc --noEmit` with `tsconfig.json`, which
`include`s only `src/server/**`, `src/cli/**`, and `src/shared/**`. Client code in
`src/client/` is compiled by Vite, which uses **esbuild** — a transpiler that
**silently strips types without checking them**. Type errors in `src/client/` never
fail CI.

`package.json` already defines `typecheck:client` (uses `tsconfig.client.json`) and
`typecheck:all`, but CI never calls either.

**Fix.** Replace the single typecheck step with the comprehensive alias:

```yaml
# ci.yml – lint-typecheck job
- name: Typecheck (all projects)
  run: npm run typecheck:all
```

`typecheck:all` calls `typecheck && typecheck:client && typecheck:test`, catching
errors across server, CLI, shared, client, and test files.

---

### C-02 · Prettier formatting never enforced in CI — format drift guaranteed

|          |                                                    |
| -------- | -------------------------------------------------- |
| **File** | `package.json` scripts; `.github/workflows/ci.yml` |

**Issue.** `prettier` is a dev dependency and `format` script runs `--write`
(auto-fix). There is no `format:check` script and CI has no prettier step. PRs with
inconsistently formatted code merge without any warning. Over time this causes noisy
diffs and style inconsistency.

**Fix.** Add a check script and run it in CI:

```json
// package.json
"format:check": "prettier --check src tests",
```

```yaml
# ci.yml – lint-typecheck job, after Lint step
- name: Format check
  run: npm run format:check
```

Also broaden the `format` write script to cover tests:

```json
"format": "prettier --write src tests",
```

---

## HIGH

### H-01 · No dependency vulnerability audit in CI

|          |                            |
| -------- | -------------------------- |
| **File** | `.github/workflows/ci.yml` |

**Issue.** No `npm audit` step exists. Vulnerable transitive dependencies (e.g. a
future `express` or `ws` CVE) would never surface in CI. Given quartostone serves
as a local web server that processes user files and runs git commands, dependency
hygiene is security-relevant.

**Fix.** Add after `npm ci` in the `lint-typecheck` job (or as its own job):

```yaml
- name: Dependency security audit
  run: npm audit --audit-level=high
```

`--audit-level=high` avoids blocking on low/moderate noise while still catching
exploitable vulnerabilities.

---

### H-02 · No `timeout-minutes` on any CI job — hung jobs waste 6 hours

|          |                                            |
| -------- | ------------------------------------------ |
| **File** | `.github/workflows/ci.yml` – all four jobs |

**Issue.** GitHub Actions defaults to a 6-hour job timeout. A deadlocked test, a
network hang in `npm ci`, or an infinite render subprocess will silently consume
runner minutes for 6 hours before GitHub kills it.

**Fix.** Add tight timeouts appropriate to each job's expected runtime:

```yaml
lint-typecheck:
  timeout-minutes: 10
test-unit:
  timeout-minutes: 15
build:
  timeout-minutes: 10
test-e2e:
  timeout-minutes: 20
```

---

### H-03 · No CI concurrency group — stale runs queue behind new pushes

|          |                                        |
| -------- | -------------------------------------- |
| **File** | `.github/workflows/ci.yml` – top-level |

**Issue.** Every push to a PR branch queues a new CI run while old ones are still
running. This wastes runner minutes and slows feedback. On busy PRs this can mean
5-deep queues.

**Fix.** Add a top-level concurrency block:

```yaml
# ci.yml – after `on:` block
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This cancels any in-progress run for the same branch/PR when a new commit is pushed.

---

### H-04 · Playwright browsers re-downloaded on every E2E run (no caching)

|          |                                             |
| -------- | ------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `test-e2e` job |

**Issue.** `npx playwright install chromium --with-deps` downloads ~200 MB of
Chromium binaries on every run. There is no caching step. This adds 1–2 minutes
to every E2E execution.

**Fix.** Cache the Playwright browser store:

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  id: playwright-cache
  with:
    path: ~/.cache/ms-playwright
    key: playwright-chromium-${{ hashFiles('package-lock.json') }}

- name: Install Playwright browsers
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install chromium --with-deps

- name: Install Playwright system deps only (cache hit)
  if: steps.playwright-cache.outputs.cache-hit == 'true'
  run: npx playwright install-deps chromium
```

---

### H-05 · `client-dist` artifact retention is only 1 day

|          |                                                    |
| -------- | -------------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `build` job, line ~75 |

**Issue.** The `client-dist` artifact is retained for only `1` day. If the E2E job
fails and someone needs to re-examine the artifact (e.g., re-running a failed job
manually), the artifact is already gone. Retention consistency also matters: coverage
and playwright-report are kept 7 days.

**Fix.**

```yaml
# build job – Upload client dist
with:
  name: client-dist
  path: dist/client/
  retention-days: 7 # was: 1
```

---

### H-06 · Missing `clean` script — stale build output causes phantom bugs

|          |                        |
| -------- | ---------------------- |
| **File** | `package.json` scripts |

**Issue.** There is no `clean` script. Deleted source files leave stale `.js` and
`.d.ts` files in `dist/`, which TypeScript's NodeNext module resolver may pick up.
This is a common source of "works locally, fails on a fresh clone" bugs.

**Fix.**

```json
"clean": "node --eval \"fs.rmSync('dist', { recursive: true, force: true })\"",
"build:fresh": "npm run clean && npm run build:all",
```

The `node --eval` approach is cross-platform (avoids `rm -rf` on Windows).

---

### H-07 · Missing `lint:fix` script — friction for contributors

|          |                        |
| -------- | ---------------------- |
| **File** | `package.json` scripts |

**Issue.** `lint` runs ESLint in check mode. There is no `lint:fix` command. When a
contributor has lint errors they must discover the `--fix` flag themselves or fix
manually. The format script uses `--write` but lint does not have an equivalent alias.

**Fix.**

```json
"lint:fix": "eslint --fix src tests",
```

---

## MEDIUM

### M-01 · `test-unit` serialised behind `lint-typecheck` — slower CI feedback

|          |                                                       |
| -------- | ----------------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `test-unit` job `needs:` |

**Issue.** Unit tests cannot start until `lint-typecheck` passes (`needs: lint-typecheck`).
Lint/typecheck typically runs fast (~30 s), but in practice this adds latency.
More critically, if a trivial lint error exists, tests never run — a developer gets
no signal about whether their logic is correct.

**Fix.** Run lint and tests in parallel; only block `test-e2e` on both:

```yaml
test-unit:
  needs: []           # remove dependency on lint-typecheck
  ...

build:
  needs: []           # remove dependency on lint-typecheck
  ...

test-e2e:
  needs: [lint-typecheck, test-unit, build]   # gate only the final job
```

---

### M-02 · E2E tests skip Quarto paths in CI — render/preview never integration-tested

|          |                                                                                     |
| -------- | ----------------------------------------------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `test-e2e` job; `vitest.config.ts` coverage exclusions |

**Issue.** `vitest.config.ts` explicitly excludes `render.ts` and `preview.ts` from
coverage, noting they are "tested via E2E". But the E2E job does not install Quarto.
The E2E tests acknowledge this with comments like `// 503 = quarto not in PATH (CI runner)`.
The render/preview API paths are therefore **never tested end-to-end in CI**.

**Fix (pragmatic).** Install Quarto in the E2E job using the GitHub release tarball:

```yaml
- name: Install Quarto
  run: |
    QUARTO_VERSION=1.6.39
    wget -q "https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-amd64.tar.gz"
    tar -xzf quarto-*.tar.gz
    sudo mv quarto-*/bin/* /usr/local/bin/
```

Then update the relevant E2E assertions to expect 200 instead of the 501/503 fallbacks.

**Fix (minimal).** Add a separate, clearly-labelled matrix entry or optional workflow
for Quarto tests so the render paths are tested at least on main.

---

### M-03 · No CodeQL / SAST workflow

|          |                                     |
| -------- | ----------------------------------- |
| **File** | `.github/workflows/` (missing file) |

**Issue.** No GitHub Code Scanning (CodeQL) is configured. Given the security
findings from the prior audit (command injection in exec.ts, path traversal, etc.),
automated SAST is important. CodeQL is free for public repos.

**Fix.** Create `.github/workflows/codeql.yml`:

```yaml
name: CodeQL
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 8 * * 1' # weekly Monday scan
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/autobuild@v3
      - uses: github/codeql-action/analyze@v3
```

---

### M-04 · No Dependabot / Renovate — dependencies never auto-updated

|          |                                       |
| -------- | ------------------------------------- |
| **File** | `.github/` (missing `dependabot.yml`) |

**Issue.** There is no Dependabot or Renovate configuration. Security patches and
minor version updates accumulate silently. Given `express`, `ws`, and `multer` handle
real HTTP traffic, keeping them current is security-relevant.

**Fix.** Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    groups:
      dev-tools:
        patterns: ['eslint*', 'typescript*', 'prettier', 'vitest*', '@vitest/*', 'vite*']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

---

### M-05 · No release workflow — releases are fully manual

|          |                                              |
| -------- | -------------------------------------------- |
| **File** | `.github/workflows/` (missing `release.yml`) |

**Issue.** There is no automated release pipeline. Tagging a version and publishing
requires manual steps, which risks inconsistent release artifacts and skipping
pre-release validation.

**Fix.** Create `.github/workflows/release.yml` triggered on `push: tags: ['v*']`:

1. Run full CI (lint, typecheck, unit tests).
2. Build server, CLI, and client.
3. Package the CLI as a tarball/zip.
4. Create a GitHub Release with the build artifact attached.

---

### M-06 · `E2E` job does not test compiled server — only `tsx`-sourced server

|          |                                             |
| -------- | ------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `test-e2e` job |

**Issue.** The E2E webServer uses `npx tsx tests/e2e/fixtures/start-server.ts`
(TypeScript source, no compilation step). The `build` job compiles the CLI+server
via `tsc`, but the E2E job never uses those compiled artifacts. Build-time issues
that only manifest in the compiled output (e.g., wrong `outDir`, missing files,
ESM interop bugs in NodeNext resolution) are never exercised.

**Fix.** Optionally add a compiled-server variant or add a smoke test:

```yaml
# In test-e2e, after downloading client-dist:
- name: Download server build
  uses: actions/download-artifact@v4
  with:
    name: server-dist
    path: dist/

# Then add to build job:
- name: Upload server dist
  uses: actions/upload-artifact@v4
  with:
    name: server-dist
    path: dist/
    retention-days: 1
```

Or add a minimal "compiled server starts" smoke test in the `build` job.

---

### M-07 · No pre-commit hooks — lint/format errors reach CI unnecessarily

|          |                                                     |
| -------- | --------------------------------------------------- |
| **File** | `package.json` (missing `prepare` / `husky` config) |

**Issue.** There are no git pre-commit hooks. Developers can commit unformatted or
lint-failing code without any local feedback, making CI the first (and only) gate.
This creates a slow feedback loop — the developer must push, wait for CI, then fix.

**Fix.** Add `husky` + `lint-staged`:

```json
// package.json devDependencies
"husky": "^9.0.0",
"lint-staged": "^15.0.0"
```

```json
// package.json scripts
"prepare": "husky"
```

```json
// package.json lint-staged config
"lint-staged": {
  "src/**/*.ts": ["eslint --fix", "prettier --write"],
  "tests/**/*.ts": ["eslint --fix", "prettier --write"]
}
```

---

## LOW

### L-01 · Node.js version `"22"` floats — builds may differ between runs

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| **File** | `.github/workflows/ci.yml` – all jobs, `node-version: "22"` |

**Issue.** Specifying `"22"` pins to the major version but floats to the latest
22.x patch and minor. A Node.js update mid-PR series can cause phantom CI
differences. `package.json` `engines` requires `>=22.0.0`, so a specific pin is
safe.

**Fix.** Pin to the current LTS line:

```yaml
node-version: '22.x'
```

Or use a `.nvmrc` / `.node-version` file and `node-version-file: '.nvmrc'` for
consistency across CI and developer machines.

---

### L-02 · Only Chromium tested in E2E — no cross-browser coverage

|          |                                           |
| -------- | ----------------------------------------- |
| **File** | `playwright.config.ts` → `projects` array |

**Issue.** Only `chromium` is listed. For a web editor that targets VS Code's
embedded browser as well as desktop browsers, verifying Firefox compatibility at
minimum is worthwhile. This is a conscious scope limitation for now, but worth
tracking.

**Fix (when ready).** Add `firefox` to the `projects` array. Keep it optional via
a `--project=chromium` flag in the daily CI run and run full browser matrix on a
weekly schedule.

---

### L-03 · No Codecov (or equivalent) — coverage trends invisible

|          |                                              |
| -------- | -------------------------------------------- |
| **File** | `.github/workflows/ci.yml` → `test-unit` job |

**Issue.** Coverage is collected as `lcov` and uploaded as an artifact, but no
service (Codecov, Coveralls) consumes it. There are no PR comments showing coverage
delta, no badge, and no historical baseline. Coverage thresholds in `vitest.config.ts`
(branches at 73%) are enforced by Vitest but the context of "is this improving?" is
lost.

**Fix.** Add a Codecov step after the artifact upload:

```yaml
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    files: coverage/lcov.info
    fail_ci_if_error: false
```

---

### L-04 · Branch coverage threshold (73%) is low relative to other metrics

|          |                                            |
| -------- | ------------------------------------------ |
| **File** | `vitest.config.ts` → `coverage.thresholds` |

**Issue.** `lines: 85`, `functions: 86`, `statements: 84` are healthy, but
`branches: 73` lags significantly. The comment acknowledges this is being
"incrementally raised." Error paths (error recovery, validation branches) are
the most security-relevant paths and the most likely to contain bugs.

**Fix.** Set a concrete milestone target (80%) with a tracking issue to drive it up
incrementally. Consider splitting coverage reporting per module to identify which
file is dragging the branch metric down.

---

### L-05 · `typecheck:all` exists but is never documented as the "correct" command

|          |                                     |
| -------- | ----------------------------------- |
| **File** | `package.json` scripts; `README.md` |

**Issue.** `typecheck:all` runs all three tsconfig checks but CI only uses `typecheck`.
This inconsistency means contributors running `npm run typecheck` locally get
different validation than CI (after fix C-01 lands, CI will use `typecheck:all`).

**Fix.** Update `CONTRIBUTING.md` to instruct contributors to run `npm run typecheck:all`
before pushing, or alias `typecheck` to `typecheck:all` once C-01 is applied.

---

## Summary Table

| ID   | Severity | File / Location              | Issue                                                  | Fix in 1 line                                       |
| ---- | -------- | ---------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| C-01 | CRITICAL | `ci.yml` lint-typecheck      | Client TS never typechecked                            | Use `npm run typecheck:all`                         |
| C-02 | CRITICAL | `ci.yml` + `package.json`    | Prettier not enforced in CI                            | Add `format:check` script + CI step                 |
| H-01 | HIGH     | `ci.yml`                     | No `npm audit`                                         | Add `npm audit --audit-level=high`                  |
| H-02 | HIGH     | `ci.yml` all jobs            | No `timeout-minutes`                                   | Add per-job timeouts (10–20 min)                    |
| H-03 | HIGH     | `ci.yml` top level           | No concurrency → stale runs                            | Add `concurrency: cancel-in-progress: true`         |
| H-04 | HIGH     | `ci.yml` test-e2e            | Playwright browsers not cached                         | Add `actions/cache@v4` for `~/.cache/ms-playwright` |
| H-05 | HIGH     | `ci.yml` build               | `client-dist` retention 1 day                          | Change to 7 days                                    |
| H-06 | HIGH     | `package.json`               | No `clean` script                                      | Add `"clean": "node --eval ..."`                    |
| H-07 | HIGH     | `package.json`               | No `lint:fix` script                                   | Add `"lint:fix": "eslint --fix src tests"`          |
| M-01 | MEDIUM   | `ci.yml` test-unit           | Tests blocked by lint gate                             | Run lint and tests in parallel                      |
| M-02 | MEDIUM   | `ci.yml` test-e2e            | Quarto not installed → render/preview never E2E tested | Install Quarto in E2E job                           |
| M-03 | MEDIUM   | `.github/workflows/` missing | No CodeQL SAST                                         | Add `codeql.yml`                                    |
| M-04 | MEDIUM   | `.github/` missing           | No Dependabot                                          | Add `dependabot.yml`                                |
| M-05 | MEDIUM   | `.github/workflows/` missing | No release workflow                                    | Add `release.yml` on tag push                       |
| M-06 | MEDIUM   | `ci.yml` test-e2e            | E2E uses tsx server, not compiled server               | Upload/download server dist artifact                |
| M-07 | MEDIUM   | `package.json`               | No pre-commit hooks                                    | Add `husky` + `lint-staged`                         |
| L-01 | LOW      | `ci.yml` all jobs            | Node version `"22"` floats                             | Pin to `"22.x"` or `.nvmrc`                         |
| L-02 | LOW      | `playwright.config.ts`       | Only Chromium tested                                   | Add Firefox project when ready                      |
| L-03 | LOW      | `ci.yml` test-unit           | Coverage not reported to Codecov                       | Add `codecov/codecov-action@v4`                     |
| L-04 | LOW      | `vitest.config.ts`           | Branch coverage at 73%                                 | Set target of 80%, track with issue                 |
| L-05 | LOW      | `package.json` / docs        | `typecheck:all` undocumented                           | Update `CONTRIBUTING.md`                            |
