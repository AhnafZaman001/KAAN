import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('id, section_id, status')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  if (session.status === 'closed') {
    return NextResponse.json({ error: 'Session is already closed.' }, { status: 409 });
  }

  // Every active student in this section...
  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id')
    .eq('section_id', session.section_id)
    .eq('active', true);

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }

  // ...who doesn't already have a record (i.e. never scanned in)...
  const { data: existingRecords } = await supabase
    .from('attendance_records')
    .select('student_id')
    .eq('session_id', session_id);

  const scannedIds = new Set((existingRecords ?? []).map((r) => r.student_id));
  const unscanned = (students ?? []).filter((s) => !scannedIds.has(s.id));

  // ...gets marked absent by default.
  if (unscanned.length > 0) {
    const absentRecords = unscanned.map((s) => ({
      session_id,
      student_id: s.id,
      status: 'A' as const,
      source: 'auto_absent' as const,
      marked_by: user.id,
    }));

    const { error: insertError } = await supabase.from('attendance_records').insert(absentRecords);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { error: closeError } = await supabase
    .from('attendance_sessions')
    .update({ status: 'closed', closed_by: user.id, closed_at: new Date().toISOString() })
    .eq('id', session_id);

  if (closeError) {
    return NextResponse.json({ error: closeError.message }, { status: 500 });
  }

  return NextResponse.json({
    closed: true,
    scanned_count: scannedIds.size,
    auto_absent_count: unscanned.length,
  });
}
