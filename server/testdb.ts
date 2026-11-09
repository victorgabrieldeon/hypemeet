// For the tests that need Postgres (they run only with DATABASE_URL set): a throwaway schema, so they never see or
// touch the real tables.

import { SQL } from "bun";
import { migrate } from "./db";

export async function testDatabase() {
  const url = process.env.DATABASE_URL!;
  const root = new SQL(url);
  const schema = `test_${crypto.randomUUID().replaceAll("-", "")}`;
  // Not user input: a fixed prefix and a UUID.
  await root.unsafe(`CREATE SCHEMA ${schema}`);
  const sql = new SQL({ url, connection: { search_path: schema } });
  await migrate(sql);
  return {
    sql,
    async drop() {
      await sql.close();
      await root.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await root.close();
    },
  };
}
