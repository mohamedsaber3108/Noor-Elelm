# Local run

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm build
# create the local D1 schema once (apply each file once to a fresh DB)
for f in drizzle/*.sql; do node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file $f; done
pnpm start    # serves the built worker at http://127.0.0.1:8787
```

PowerShell: loop with `foreach($f in Get-ChildItem drizzle\*.sql | sort Name){ ... --file $f.FullName }`.

Create an account at `/register`. To make it a reviewer locally:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command "UPDATE users SET role='reviewer' WHERE email='you@example.com'"
```

Checks: `pnpm lint`, `npx tsc --noEmit`, `pnpm build`. Health: `GET /api/health`.
Production: see `DEPLOY_CLOUDFLARE.md`.
