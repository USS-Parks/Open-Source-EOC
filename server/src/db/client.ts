import postgres from "postgres";

export type Sql = postgres.Sql;

export interface DbConfig {
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
}

/**
 * Connect from an explicit config or the environment. OPENEOC_DATABASE_URL
 * wins; OPENEOC_PG_SOCKET selects a unix-socket host directory (local dev
 * and the sandboxed test cluster).
 */
export function connect(config: DbConfig = {}): Sql {
  const url = config.url ?? process.env.OPENEOC_DATABASE_URL;
  if (url) return postgres(url, { onnotice: () => undefined });
  return postgres({
    host: config.host ?? process.env.OPENEOC_PG_SOCKET ?? "/tmp/pg",
    port: config.port ?? Number(process.env.OPENEOC_PG_PORT ?? 5433),
    database: config.database ?? process.env.OPENEOC_PG_DATABASE ?? "openeoc_test",
    username: config.user ?? process.env.OPENEOC_PG_USER ?? "postgres",
    onnotice: () => undefined,
  });
}
