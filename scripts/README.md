# Staging setup + smoke testing

Why this exists: right now there's one Supabase project and one
Vercel deployment. A bad migration pushed at night means KIPS can't
take attendance the next morning, with no safety net. This fixes that.

## One-time staging setup

1. **New Supabase project.** Create a second project in your Supabase
   dashboard — this is your staging DB, fully separate from
   production data.
2. **Run all migrations against it**, in order, from
   `supabase/migrations/`. Same files, same order, just pointed at
   the new project's SQL editor.
3. **Run `supabase/seed.sql`** against staging too, so you have a
   known test school/section/students to run the smoke test against.
4. **New Vercel project** (or a Vercel preview deployment) pointed at
   the same GitHub repo, but with its own environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` →
     staging project's values, not production's
   - `ALLOW_TEST_LOGIN=true` — enables `/api/test-login`, which the
     smoke test needs to authenticate. **Never set this on
     production.**

## Before trusting any migration or deploy in production

1. Run the new migration against **staging** first.
2. Deploy the app changes to the **staging** Vercel deployment.
3. Run the smoke test against staging (below).
4. Only once that passes clean, run the migration against production
   and deploy there.

## Running the smoke test

```bash
STAGING_URL=https://your-staging-deployment.vercel.app \
TEST_EMAIL=your-staging-admin@example.com \
TEST_PASSWORD=your-staging-password \
TEST_SECTION_ID=<a section id from your staging DB> \
TEST_QR_TOKENS=<comma-separated qr_tokens of a couple test students> \
node scripts/smoke-test.mjs
```

Get `TEST_SECTION_ID` and student `qr_token` values by querying your
staging DB directly:

```sql
select id, name from sections where name = 'FSc-1st-A';
select qr_token, full_name from students where section_id = '<that id>';
```

What it checks, end to end: site is up → sign in works → session
opens → each test QR scans successfully → re-scanning the same QR
is correctly flagged as a repeat, not a fresh check-in → closing the
session marks exactly the right number of students absent (everyone
who wasn't in your `TEST_QR_TOKENS` list).

It refuses to run at all if `STAGING_URL` looks like the production
URL — a deliberate guardrail against accidentally running a
destructive-ish test (it creates a real attendance session and
records) against real school data.
