# Local run

Node 22+ and the Sites development environment are required. Install dependencies with `node <sites-plugin-root>/scripts/install-dependencies.mjs`; build with `node <sites-plugin-root>/scripts/build-site.mjs`. The app uses D1, not PostgreSQL.

To create a fresh local D1 schema after build:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_crazy_doctor_doom.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_spotty_charles_xavier.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_redundant_puma.sql
```

Apply each only once to a fresh database; existing environments apply only pending migrations. `npm start` serves the built Worker locally. Hosted Sites applies checked-in migrations during publication. Set `REVIEWER_EMAILS` or `REVIEWER_IDS` through hosting environment variables to enable private draft text, import and CMS review. Never expose draft review privileges to a public user role.
