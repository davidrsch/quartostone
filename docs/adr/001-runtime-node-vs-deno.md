# ADR 001: Runtime — Node.js 22+ LTS

**Status:** Accepted  
**Date:** 2026-03-01  
**Issue:** [spike: evaluate Deno vs Node.js for server runtime #15](https://github.com/davidrsch/quartostone/issues/15)

## Context

QuartoStone needs a server runtime to power the local HTTP/WebSocket server, CLI binary,
file watcher, and build toolchain. The two credible options are **Node.js 22 LTS** and
**Deno 2**. Both can run TypeScript natively and access the filesystem and network.

## Decision Drivers

| Factor | Weight |
|---|---|
| Ecosystem compatibility (npm packages) | High |
| Toolchain maturity (lint, typecheck, bundle) | High |
| CLI distribution (single binary) | Medium |
| Long-term maintenance risk | Medium |
| Developer familiarity | Low |

## Options Considered

### Option A — Node.js 22 LTS (chosen)

**Pros:**
- All chosen dependencies (`express`, `chokidar`, `simple-git`, `ws`, `commander`, `yaml`)
  publish stable typed Node.js packages with zero compatibility shims needed.
- `tsx` provides instant TypeScript execution in development with fast startup.
- ESLint 9 flat config + typescript-eslint works natively; same toolchain for server and
  client TypeScript.
- Vite (chosen for client bundling) runs on Node.js; no cross-runtime friction.
- `actions/setup-node` is the most battle-tested CI action; matrix testing across Node
  versions is trivial.
- `npm pack` / `npm publish` CLI distribution path is well-understood.
- Long-term: Node.js 22 is LTS until 2027; 24 LTS follows in 2025.

**Cons:**
- Requires explicit TypeScript compilation step (`tsc`) for production.
- No built-in permissions model (Deno's sandboxing is a security advantage we forfeit).
- `node_modules` vs Deno's URL-based imports (minor DX difference).

### Option B — Deno 2

**Pros:**
- Built-in TypeScript execution without `tsx`/`tsc` tooling.
- Granular permissions model as a security layer.
- `deno compile` produces a self-contained binary with no Node.js install required on end-user machines.
- URL imports eliminate `node_modules` entirely.

**Cons:**
- npm compatibility via `npm:` specifiers works for most packages but adds a shim layer;
  some packages (notably older `chokidar` versions) required workarounds at time of evaluation.
- ESLint 9 runs on Node.js; `deno lint` is a different tool with different rule sets —
  maintaining two lint configs would fragment the DX.
- Vite does not run on Deno; would need `esbuild` alone for client bundling, losing the
  HMR and plugin ecosystem.
- Smaller pool of maintainers familiar with Deno in open-source contributor base.
- `deno compile` single-binary is appealing but adds ~90 MB to distributed artifacts.

## Decision

**Node.js 22 LTS.**

The dependency ecosystem, CI tooling, and client bundling pipeline are all natively
Node.js-based. Introducing Deno would create friction at every layer (lint, bundle, CI)
without a clear net benefit for this specific workload (local dev server + CLI tool).

The security argument for Deno's permissions model is noted but not a priority for a
local-only, single-user application where the process already has full filesystem access
by design.

This decision should be **revisited** if:
- A future phase requires packaging QuartoStone as a self-contained installer (at which
  point `deno compile` vs `pkg`/`nexe` should be re-evaluated).
- Node.js drops LTS for 22 ahead of schedule.

## Consequences

- Runtime: `node >= 22` pinned in `package.json` `engines` field.
- Dev runner: `tsx` for `npm run dev:server`.
- Build: `tsc` to `dist/`.
- CI: `actions/setup-node@v4` with `node-version: '22'`.
- Client bundle: Vite (to be set up in client build pipeline task).
