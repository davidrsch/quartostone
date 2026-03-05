# ADR 005: Raw WebSocket (`ws` library) for real-time events

**Status:** Accepted  
**Date:** 2026-03-05

## Context

The QuartoStone editor needs to push real-time events from the server to all connected
browser tabs — file-change notifications, render start/done signals, and Git status
updates. The options evaluated were: **Socket.IO**, **Server-Sent Events (SSE)**,
**long-polling**, and a **raw WebSocket** via the `ws` npm package.

## Decision Drivers

| Factor                                               | Weight |
| ---------------------------------------------------- | ------ |
| Zero browser-side runtime dependency                 | High   |
| Compatibility with the Vite HMR dev-server proxy     | High   |
| Bundle size impact on the client                     | High   |
| Bi-directional messaging (future use)                | Medium |
| Operational simplicity (no fallback transport logic) | Medium |

## Decision

Use the `ws` library directly, mounted on the same HTTP server as Express:

```ts
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
```

All events are broadcast as JSON strings:

```json
{ "event": "render_done", "data": { "path": "intro.qmd", "ok": true } }
```

The client connects with the native browser `WebSocket` API — no library required.

During Vite development the `vite.config.ts` proxy forwards `/ws` to the Express
server, so HMR and the quartostone event stream coexist on the same dev port without
CORS complications.

## Consequences

**Positive:**

- No client-side Socket.IO bundle (~250 kB min+gzip) needed.
- The native `WebSocket` API works in every modern browser.
- The `/ws` path integrates cleanly with the Vite dev proxy.
- `ws` is already a transitive dependency of Vite; no new package is introduced.
- The simple broadcast model is straightforward to reason about and test.

**Negative:**

- `ws` does not include automatic reconnection or heartbeat logic; the client must
  implement its own reconnect loop.
- No namespaces or rooms — all connected clients receive every event (acceptable
  because QuartoStone is a single-user local app).
- If bi-directional messaging becomes complex in future, a higher-level protocol
  may be needed.

## Alternatives Considered

### Socket.IO
Adds automatic reconnection and room support, but brings a large client bundle and
a separate protocol layer on top of WebSocket. Overkill for a single-user local tool.

### Server-Sent Events (SSE)
Unidirectional only, which is sufficient for current needs, but SSE connections are
sometimes poorly handled by proxies and would complicate future bi-directional use.

### Long-polling
High latency, high server overhead for frequent file-change events. Dismissed early.
