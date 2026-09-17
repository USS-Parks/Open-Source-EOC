/**
 * @openeoc/server
 * Node backend. Framework decision (Fastify vs NestJS) lands in VEOC-04;
 * until then this package holds only the workspace wiring proof.
 */

import { workspaceInfo } from "@openeoc/shared";

export const serverInfo = workspaceInfo("@openeoc/server");
