/**
 * @openeoc/server
 * Node backend (Fastify, per ADR-0001).
 */

import { workspaceInfo } from "@openeoc/shared";

export const serverInfo = workspaceInfo("@openeoc/server");

export { buildApp, type BuildAppOptions } from "./app.js";
export { connect, type Sql } from "./db/client.js";
export { migrate } from "./db/migrate.js";
export { withPerson } from "./db/context.js";
export * from "./auth/service.js";
export * from "./auth/authz.js";
export * from "./audit/service.js";
export { OidcClient, oidcSettingsFromEnv, type OidcSettings } from "./auth/oidc.js";
