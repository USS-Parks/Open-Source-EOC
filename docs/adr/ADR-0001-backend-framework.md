# ADR-0001: Backend framework is Fastify

Status: accepted, 2026-09-17 (VEOC-04)

## Decision

The Node backend uses Fastify with zod-backed request/response validation.

## Alternatives considered

- **NestJS:** richer structure (DI, decorators, modules) but a heavy
  abstraction layer, slower cold paths, and a framework idiom that raises
  the bar for occasional contributors. Its structure benefits large teams;
  this project is built for a small maintainer set and long life (INV-10).
- **Express:** ubiquitous but unmaintained-in-practice core, no first-class
  schema validation, weaker TypeScript story.
- **Hono/Elysia:** modern and fast but younger ecosystems; a 15-year
  platform should not bet its server on a framework without a decade of
  track record.

## Grounds

- Schema-first: every route declares zod schemas that come from
  `@openeoc/shared`, so the wire contract and the dictionary are one thing.
- Plain functions and plugins, no decorators or DI container: the code a
  county IT contributor reads is the code that runs.
- Proven WebSocket support for the sync layer (VEOC-13).

## Reversal cost

Moderate. Route handlers are thin by contract (logic lives in services),
so a framework swap touches the HTTP layer only. The service layer and
schemas are framework-free by design; keep them that way.
