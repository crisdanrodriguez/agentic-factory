import { runner } from 'node-pg-migrate';
const databaseUrl = process.env.FACTORY_MIGRATION_URL;
if (!databaseUrl) throw new Error('FACTORY_MIGRATION_URL is required; migrations never use runtime credentials.');
await runner({ databaseUrl, dir: 'migrations', direction: 'up', migrationsTable: 'factory_migrations', log: console.log });
