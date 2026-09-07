/**
 * KAAN — Staging smoke test
 * ==========================
 * Simulates a real kiosk session end to end against a deployed
 * environment: sign in -> open session -> scan N students ->
 * close session -> verify the right number got auto-marked absent.
 *
 * Run this against STAGING before trusting a migration or deploy
 * in production. It does NOT run against production by default —
 * you have to explicitly point it there, which is deliberate.
 *
 * Usage:
 *   STAGING_URL=https://kaan-staging.vercel.app \
 *   TEST_EMAIL=test@example.com \
 *   TEST_PASSWORD=... \
 *   TEST_SECTION_ID=<uuid> \
 *   node scripts/smoke-test.mjs
 *
 * TEST_SECTION_ID should be a section in your staging DB with a
 * known, small roster (the seed script's FSc-1st-A works well —
 * 5 students). The test scans however many QR tokens you pass in
 * TEST_QR_TOKENS (comma-separated) and expects the rest of that
 * section's active students to end up auto-absent.
 */

const BASE_URL = process.env.STAGING_URL;
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const SECTION_ID = process.env.TEST_SECTION_ID;
const QR_TOKENS = (process.env.TEST_QR_TOKENS ?? '').split(',').filter(Boolean);

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

async function main() {
  if (!BASE_URL || !EMAIL || !PASSWORD || !SECTION_ID) {
    fail('Missing required env vars: STAGING_URL, TEST_EMAIL, TEST_PASSWORD, TEST_SECTION_ID');
  }

  if (BASE_URL.includes('kaan-flame.vercel.app')) {
    fail('STAGING_URL points at what looks like production. Refusing to run — point this at staging.');
  }

  // ---- 1. Site is up ----
  const healthRes = await fetch(`${BASE_URL}/login`);
  if (!healthRes.ok) fail(`Login page returned ${healthRes.status} — is the deploy up?`);
  pass('Site is reachable');

  // ---- 2. Sign in (via Supabase-compatible cookie session) ----
  // This hits Next.js directly rather than Supabase's auth API, so
  // the resulting cookies work against our own API routes.
  const loginRes = await fetch(`${BASE_URL}/api/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    fail(
      `Login failed (${loginRes.status}). Make sure ALLOW_TEST_LOGIN=true is set on your ` +
        `staging deployment's environment variables — this route 404s otherwise, deliberately, ` +
        `so it can never accidentally work in production.`
    );
  }
  const cookies = loginRes.headers.get('set-cookie');
  pass('Signed in');

  const authedFetch = (path, options = {}) =>
    fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { ...options.headers, Cookie: cookies ?? '' },
    });

  // ---- 3. Open a session ----
  const today = new Date().toISOString().slice(0, 10);
  const openRes = await authedFetch('/api/kiosk/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section_id: SECTION_ID, session_date: today }),
  });
  const openData = await openRes.json();
  if (!openRes.ok) fail(`Could not open session: ${openData.error}`);
  pass(`Session opened (${openData.total_active_students} active students)`);

  const sessionId = openData.session_id;

  // ---- 4. Scan each test QR token ----
  let scannedOk = 0;
  for (const token of QR_TOKENS) {
    const scanRes = await authedFetch('/api/kiosk/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, qr_token: token }),
    });
    const scanData = await scanRes.json();
    if (!scanRes.ok) fail(`Scan failed for token ${token}: ${scanData.error}`);
    scannedOk++;
  }
  pass(`Scanned ${scannedOk}/${QR_TOKENS.length} test students`);

  // ---- 5. Duplicate-scan guardrail check ----
  if (QR_TOKENS.length > 0) {
    const repeatRes = await authedFetch('/api/kiosk/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, qr_token: QR_TOKENS[0] }),
    });
    const repeatData = await repeatRes.json();
    if (!repeatRes.ok || repeatData.is_first_scan !== false) {
      fail('Repeat-scan guardrail did not correctly report is_first_scan: false');
    }
    pass('Repeat-scan guardrail correctly detected');
  }

  // ---- 6. Close session and verify auto-absent math ----
  const closeRes = await authedFetch('/api/kiosk/session/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const closeData = await closeRes.json();
  if (!closeRes.ok) fail(`Could not close session: ${closeData.error}`);

  const expectedAbsent = openData.total_active_students - scannedOk;
  if (closeData.auto_absent_count !== expectedAbsent) {
    fail(
      `Auto-absent count mismatch: expected ${expectedAbsent}, got ${closeData.auto_absent_count}`
    );
  }
  pass(`Session closed correctly: ${closeData.scanned_count} present, ${closeData.auto_absent_count} auto-absent`);

  console.log('\nAll smoke tests passed.');
}

main().catch((err) => fail(err.message));
