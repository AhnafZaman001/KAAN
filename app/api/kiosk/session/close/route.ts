import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  SESSION_NOT_FOUND: { message: 'Session not found.', status: 404 },
  SESSION_ALREADY_CLOSED: { message: 'Session is already closed.', status: 409 },
};

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { session_id } = await request.json();
  if (!session_id) {
    return NextResponse.json({ error: 'session_id is required.' }, { status: 400 });
  }

  // Single atomic function: the "who hasn't scanned" check and the
  // absent-marking insert happen in one statement inside one
  // transaction, so a scan can't land unseen in the gap between
  // reading and writing. See migrations/006_kiosk_functions.sql.
  const { data, error } = await supabase
    .rpc('close_attendance_session', {
      p_session_id: session_id,
      p_closed_by: user.id,
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
    closed: true,
    scanned_count: (data as any).scanned_count,
    auto_absent_count: (data as any).auto_absent_count,
  });
}
