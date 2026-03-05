// src/server/context.ts
// Shared context type passed to all API route registration functions.
import type { QuartostoneConfig } from './config.js';

export interface ServerContext {
  cwd: string;
  config: QuartostoneConfig;
  port: number;
  /** Explicit path to the built editor client (dist/client/). */
  clientDist?: string;
  /** Auth token for API requests. Undefined in test mode (disables auth). */
  token?: string;
}
