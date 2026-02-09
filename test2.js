// test2.js
import "dotenv/config";
import pg from "pg";

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("❌ DATABASE_URL is missing in your environment / .env");
  process.exit(1);
}

console.log("DATABASE_URL =", cs);

const u = new URL(cs);
console.log("Host:", u.hostname);
console.log("Port:", u.port || "(default)");
console.log("DB  :", u.pathname);

// Enable SSL only when you're hitting AWS RDS
const useSSL = u.hostname.includes(".rds.amazonaws.com");

const pool = new pg.Pool({
  connectionString: cs,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

try {
  const r = await pool.query("select now() as now");
  console.log("✅ Connected. Server time:", r.rows[0].now);
} finally {
  await pool.end();
}
