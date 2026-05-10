// Aplica IF NOT EXISTS para idempotencia
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(`ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "validDaysAfterIssue" INTEGER`);
console.log('OK Card.validDaysAfterIssue');
await c.end();
