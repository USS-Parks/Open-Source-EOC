import { describe, expect, it } from "vitest";
import {
  assertCompatibleMigrationHistory,
  BASELINE_MIGRATION,
} from "../db/migrate.js";

describe("pre-release migration baseline guard", () => {
  const files = [BASELINE_MIGRATION, "0102_example.sql"];

  it("allows a fresh database and a database already on the baseline", () => {
    expect(() => assertCompatibleMigrationHistory([], files)).not.toThrow();
    expect(() => assertCompatibleMigrationHistory(
      [BASELINE_MIGRATION, "0102_example.sql"],
      files,
    )).not.toThrow();
  });

  it("refuses retired 0001 through 0101 history even if the baseline row was added", () => {
    expect(() => assertCompatibleMigrationHistory(
      ["0001_identity.sql", "0101_file_record_attachments.sql"],
      files,
    )).toThrow(/schema_migrations contains retired rows.*0001_identity.*0101_file_record/u);
    expect(() => assertCompatibleMigrationHistory(
      [BASELINE_MIGRATION, "0085_esf_lifeline_assessments.sql"],
      files,
    )).toThrow(/schema_migrations contains retired rows.*0085_esf/u);
  });

  it("refuses unexplained migration history without a baseline receipt", () => {
    expect(() => assertCompatibleMigrationHistory(["0102_example.sql"], files))
      .toThrow(/migration history without 0001_baseline\.sql/u);
    expect(() => assertCompatibleMigrationHistory(["custom.sql"], files))
      .toThrow(/unrecognized rows.*custom\.sql/u);
    expect(() => assertCompatibleMigrationHistory(
      [BASELINE_MIGRATION, "custom.sql"],
      files,
    )).toThrow(/unrecognized rows.*custom\.sql/u);
  });

  it("does not constrain a migration directory that predates the baseline", () => {
    expect(() => assertCompatibleMigrationHistory(
      ["0001_identity.sql"],
      ["0001_identity.sql", "0002_authz.sql"],
    )).not.toThrow();
  });
});
