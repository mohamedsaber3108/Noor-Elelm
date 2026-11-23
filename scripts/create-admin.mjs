// Usage: node scripts/create-admin.mjs <email> <password|-> [name] > admin.sql   ("-" reads ADMIN_PASSWORD)
// Then:  npx wrangler d1 execute <db> --remote --file admin.sql   (or --local for development)
// Produces a password hash compatible with app/auth.ts (PBKDF2-SHA256, 100k iterations).
import { webcrypto as c } from "node:crypto";
const [email, passwordArg, name = "Admin"] = process.argv.slice(2);
// Pass "-" as the password to read it from ADMIN_PASSWORD (keeps it out of the process list).
const password = passwordArg === "-" ? process.env.ADMIN_PASSWORD : passwordArg;
if (!email || !password || password.length < 10) {
  console.error("Usage: node scripts/create-admin.mjs <email> <password(min 10 chars)> [name]");
  process.exit(64);
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const salt = c.getRandomValues(new Uint8Array(16));
const key = await c.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await c.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
const b64 = (u) => Buffer.from(u).toString("base64");
const hash = `pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
console.log(
  `INSERT INTO users(id,email,display_name,password_hash,role) VALUES(${q(c.randomUUID())},${q(email.trim().toLowerCase())},${q(name)},${q(hash)},'admin') ` +
    `ON CONFLICT(email) DO UPDATE SET role='admin', password_hash=excluded.password_hash;`,
);
