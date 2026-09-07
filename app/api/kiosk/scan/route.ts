import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  SESSION_NOT_FOUND: { message: 'Session not found.', status: 404 },
  SESSION_CLOSED: { message: 'This session has already ended.', status: 409 },
  STUDENT_NOT_FOUND: { message: 'QR code not recognized.', status: 404 },
  STUDENT_INACTIVE: { message: 'This student is not active.', status: 400 },
  WRONG_SECTION: { message: 'This student is not in this section — wrong kiosk?', status: 400 },
  RATE_LIMITED: { message: 'Too many scan attempts — slow down a moment.', status: 429 },
};

function getClientInfo(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const userAgent = request.headers.get('user-agent');
  return { ip, userAgent };
}

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { session_id, qr_token } = await request.json();
  if (!session_id || !qr_token) {
    return NextResponse.json({ error: 'session_id and qr_token are required.' }, { status: 400 });
  }

  const { ip, userAgent } = getClientInfo(request);

  // One atomic round-trip: validates session + student, writes the
  // scan, checks the rate limit, and logs the audit entry — all
  // inside a single Postgres function call. See
  // supabase/migrations/006_kiosk_functions.sql and
  // supabase/migrations/007_scan_rate_limit_audit.sql.
  const { data, error } = await supabase
    .rpc('record_scan', {
      p_session_id: session_id,
      p_qr_token: qr_token,
      p_marked_by: user.id,
      p_ip_address: ip,
      p_user_agent: userAgent,
    })
    .single();

  if (error) {
    const known = ERROR_MESSAGES[error.message];
    if (known) {
      return NextResponse.json({ error: known.message }, { status: known.status });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    full_name: (data as any).full_name,
    roll_number: (data as any).roll_number,
    is_first_scan: (data as any).is_first_scan,
  });
}
