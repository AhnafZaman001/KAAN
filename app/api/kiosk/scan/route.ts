import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  SESSION_NOT_FOUND: { message: 'Session not found.', status: 404 },
  SESSION_CLOSED: { message: 'This session has already ended.', status: 409 },
  STUDENT_NOT_FOUND: { message: 'QR code not recognized.', status: 404 },
  STUDENT_INACTIVE: { message: 'This student is not active.', status: 400 },
  WRONG_SECTION: { message: 'This student is not in this section — wrong kiosk?', status: 400 },
};

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

  // One atomic round-trip: validates session + student + writes the
  // scan, all inside a single Postgres function call. See
  // supabase/migrations/006_kiosk_functions.sql for why this replaced
  // the earlier multi-query version.
  const { data, error } = await supabase
    .rpc('record_scan', {
      p_session_id: session_id,
      p_qr_token: qr_token,
      p_marked_by: user.id,
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
  });
}
