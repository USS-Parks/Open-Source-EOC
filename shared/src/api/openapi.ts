import { z } from "zod";
import { ServiceIdentityCreateSchema } from "../auth/service-identities.js";
import {
  EquipmentHoursSchema,
  EquipmentRateImportSchema,
  ForceAccountRollUpSchema,
  LaborRateSchema,
} from "../damage/force-account.js";
import { DashboardTemplateSchema } from "../dashboards/def.js";
import { CreateEsfAssessmentSchema } from "../esf/contract.js";
import { FormDefinitionSchema, FormFieldSchema, FormNodeSchema } from "../forms/xlsform.js";
import { IncidentAreaUpdateSchema } from "../incidents/area.js";
import {
  IncidentParticipantGrantInputSchema,
  IncidentParticipantRevokeInputSchema,
} from "../incidents/participation.js";
import { AssessmentDecisionSchema, CreateLifelineAssessmentSchema } from "../lifelines/contract.js";
import { PlanActivateSchema, PlanSaveSchema } from "../plans/contract.js";
import { OperationalRelationshipCreateSchema } from "../relationships/contract.js";
import { TaskCompletionRequestSchema, TaskCreateSchema, TaskMetadataPatchSchema } from "../tasks/contract.js";
import {
  VolunteerDeploymentSchema,
  VolunteerDeploymentUpdateSchema,
  VolunteerSchema,
} from "../volunteers/contract.js";
import { API_CONTRACT, type ApiContract, type RestEndpoint } from "./contract.js";

/**
 * The API as an OpenAPI 3.1 document (VC-25), generated from the same frozen
 * contract as docs/API.md. A request body carries a schema only where the
 * server validates that body whole with a schema this package exports; the
 * map below names each such route. Every other body, every response body
 * and every query string is marked as not published, never guessed.
 */

const REQUEST_SCHEMAS: Readonly<Record<string, readonly [name: string, schema: z.ZodType]>> = {
  "POST /api/v1/dashboard-templates": ["DashboardTemplate", DashboardTemplateSchema],
  "POST /api/v1/incidents/:incidentId/equipment-hours": ["EquipmentHours", EquipmentHoursSchema],
  "POST /api/v1/incidents/:incidentId/esf-assessments": ["CreateEsfAssessment", CreateEsfAssessmentSchema],
  "POST /api/v1/incidents/:incidentId/esf-assessments/:framework/:esf/decisions": ["AssessmentDecision", AssessmentDecisionSchema],
  "POST /api/v1/incidents/:incidentId/force-account/roll-up": ["ForceAccountRollUp", ForceAccountRollUpSchema],
  "POST /api/v1/incidents/:incidentId/lifeline-assessments": ["CreateLifelineAssessment", CreateLifelineAssessmentSchema],
  "POST /api/v1/incidents/:incidentId/lifeline-assessments/:lifeline/decisions": ["AssessmentDecision", AssessmentDecisionSchema],
  "POST /api/v1/incidents/:incidentId/operational-relationships": ["OperationalRelationshipCreate", OperationalRelationshipCreateSchema],
  "POST /api/v1/incidents/:incidentId/participants": ["IncidentParticipantGrant", IncidentParticipantGrantInputSchema],
  "POST /api/v1/incidents/:incidentId/participants/:participantId/revoke": ["IncidentParticipantRevoke", IncidentParticipantRevokeInputSchema],
  "POST /api/v1/incidents/:incidentId/tasks": ["TaskCreate", TaskCreateSchema],
  "POST /api/v1/incidents/:incidentId/tasks/:taskId/complete": ["TaskCompletionRequest", TaskCompletionRequestSchema],
  "POST /api/v1/incidents/:incidentId/volunteers": ["Volunteer", VolunteerSchema],
  "POST /api/v1/jurisdictions/:jurisdictionId/forms": ["FormDefinition", FormDefinitionSchema],
  "POST /api/v1/jurisdictions/:jurisdictionId/pa-equipment-rates": ["EquipmentRateImport", EquipmentRateImportSchema],
  "POST /api/v1/jurisdictions/:jurisdictionId/plans": ["PlanSave", PlanSaveSchema],
  "POST /api/v1/jurisdictions/:jurisdictionId/service-identities": ["ServiceIdentityCreate", ServiceIdentityCreateSchema],
  "POST /api/v1/jurisdictions/:jurisdictionId/volunteers": ["Volunteer", VolunteerSchema],
  "POST /api/v1/plans/:planId/activate": ["PlanActivate", PlanActivateSchema],
  "POST /api/v1/volunteers/:volunteerId/deployments": ["VolunteerDeployment", VolunteerDeploymentSchema],
  "PATCH /api/v1/incidents/:incidentId/tasks/:taskId": ["TaskMetadataPatch", TaskMetadataPatchSchema],
  "PUT /api/v1/incidents/:incidentId/operational-area": ["IncidentAreaUpdate", IncidentAreaUpdateSchema],
  "PUT /api/v1/jurisdictions/:jurisdictionId/pa-labor-rates/:personId": ["LaborRate", LaborRateSchema],
  "PUT /api/v1/plans/:planId": ["PlanSave", PlanSaveSchema],
  "PUT /api/v1/volunteer-deployments/:deploymentId": ["VolunteerDeploymentUpdate", VolunteerDeploymentUpdateSchema],
  "PUT /api/v1/volunteers/:volunteerId": ["Volunteer", VolunteerSchema],
};

/** Routes whose request schema this document publishes, by "METHOD path". */
export const OPENAPI_REQUEST_SCHEMA_ROUTES: readonly string[] = Object.keys(REQUEST_SCHEMAS);

const SECURITY: Readonly<Record<RestEndpoint["auth"], ReadonlyArray<Record<string, never[]>>>> = {
  bearer: [{ bearer: [] }],
  "peer-token": [{ peerToken: [] }],
  "feed-token": [{ feedToken: [] }],
  "intake-token": [{ intakeToken: [] }],
  "metrics-token": [{ metricsToken: [] }],
  none: [],
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** "GET /api/v1/boards/:boardId" becomes "getBoardsByBoardId". */
function operationId(method: string, path: string): string {
  const words = path.split("/").slice(3).map((segment) => {
    const param = segment.startsWith(":");
    const word = (param ? segment.slice(1) : segment).replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ?? "").toUpperCase());
    const capital = word.charAt(0).toUpperCase() + word.slice(1);
    return param ? `By${capital}` : capital;
  });
  return method.toLowerCase() + words.join("");
}

/** Request schemas as JSON Schema 2020-12 components, each named once. */
function componentSchemas(): Record<string, Json> {
  const registry = z.registry<{ id: string }>();
  // A form's recursive node tree gets names of its own.
  const parts: Array<readonly [string, z.ZodType]> = [["FormNode", FormNodeSchema], ["FormField", FormFieldSchema]];
  for (const [name, schema] of [...Object.values(REQUEST_SCHEMAS), ...parts]) {
    if (!registry.has(schema)) registry.add(schema, { id: name });
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
    uri: (id) => `#/components/schemas/${id}`,
  });
  const out: Record<string, Json> = {};
  for (const name of Object.keys(schemas).sort()) {
    const { $schema: _dialect, $id: _id, ...schema } = schemas[name] as Record<string, Json>;
    out[name] = schema;
  }
  return out;
}

/** Generate the OpenAPI 3.1 document for a contract. Deterministic. */
export function generateOpenApi(contract: ApiContract = API_CONTRACT): Record<string, Json> {
  const paths: Record<string, Record<string, Json>> = {};
  const endpoints = [...contract.rest].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path}`;
    const path = endpoint.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const params = [...endpoint.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1]!,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const published = REQUEST_SCHEMAS[key];
    const takesBody = endpoint.method === "POST" || endpoint.method === "PUT" || endpoint.method === "PATCH";
    const operation: Record<string, Json> = {
      operationId: operationId(endpoint.method, endpoint.path),
      tags: [endpoint.tag],
      summary: endpoint.summary,
      security: endpoint.personOnly ? [{ personSession: [] }] : SECURITY[endpoint.auth].map((entry) => ({ ...entry })),
      ...(params.length ? { parameters: params } : {}),
      ...(published
        ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${published[0]}` } } } } }
        : takesBody ? { requestBody: { $ref: "#/components/requestBodies/Unpublished" } } : {}),
      responses: {
        "2XX": { $ref: "#/components/responses/Unpublished" },
        "4XX": { $ref: "#/components/responses/Refused" },
      },
      "x-openeoc-audience": endpoint.audience,
      ...(endpoint.integration ? { "x-openeoc-integration": `OPENEOC_INTEGRATIONS=${endpoint.integration}` } : {}),
    };
    (paths[path] ??= {})[endpoint.method.toLowerCase()] = operation;
  }
  const tags = [...new Set(contract.rest.map((e) => e.tag))].sort().map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    info: {
      title: "Open Source EOC API",
      version: contract.version,
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
      description: [
        "Generated from the frozen API contract, as docs/API.md is. Every path is held to the server's route table by a contract test.",
        "Request bodies carry a schema only where the server validates the whole body with a published schema; responses and query strings are not described.",
        "Operations marked x-openeoc-integration are registered only when that name is in OPENEOC_INTEGRATIONS.",
        "The bearer scheme takes a person's session access token or a service identity token (oeoc-svc.<id>.<secret>) issued by a jurisdiction administrator; operations under the personSession scheme refuse a service identity token.",
      ].join(" "),
    },
    security: [{ bearer: [] }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "A session access token from sign-in, or a service identity token." },
        personSession: {
          type: "http",
          scheme: "bearer",
          description: "A person's session access token from sign-in only; a service identity token is refused. The WebSocket routes take it in their first frame.",
        },
        peerToken: { type: "apiKey", in: "header", name: "x-peer-token", description: "The token a federation peer was issued." },
        feedToken: { type: "apiKey", in: "header", name: "x-feed-token", description: "The ingest token of one feed." },
        intakeToken: { type: "apiKey", in: "header", name: "x-intake-token", description: "The jurisdiction's damage intake token." },
        metricsToken: { type: "http", scheme: "bearer", description: "OPENEOC_METRICS_TOKEN; the route answers 404 while it is unset." },
      },
      requestBodies: {
        Unpublished: {
          description: "This document does not publish a schema for this route's request body, if it takes one.",
          content: { "application/json": { schema: {} } },
        },
      },
      responses: {
        Unpublished: { description: "Success. This document does not publish a schema for the response body." },
        Refused: {
          description: "Refused. JSON routes answer with an object whose error string gives the reason.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
        ...componentSchemas(),
      },
    },
  };
}
