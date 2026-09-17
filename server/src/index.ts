/**
 * @openeoc/server
 * Node backend (Fastify, per ADR-0001).
 */

import { workspaceInfo } from "@openeoc/shared";

export const serverInfo = workspaceInfo("@openeoc/server");

export { buildApp } from "./app.js";
export { connect, type Sql } from "./db/client.js";
export { migrate } from "./db/migrate.js";
export * from "./auth/service.js";
