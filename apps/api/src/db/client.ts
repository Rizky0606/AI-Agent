import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

export const createDatabase = (url: string) => {
  const client = postgres(url, { max: 10, prepare: false });
  return { client, db: drizzle(client, { schema }) };
};

export type Database = ReturnType<typeof createDatabase>['db'];
