import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Exists only so scripts/smoke-test.mjs can authenticate without a
// browser. Gated behind an env var that should ONLY ever be set on
// staging — never production. Without ALLOW_TEST_LOGIN=true, this
// route does nothing but 404.
export async function POST(request: NextRequest) {
  if (process.env.ALLOW_TEST_LOGIN !== 'true') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required.' }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
