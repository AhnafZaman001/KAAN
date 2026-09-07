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

  const { session_id, qr_token } = await request.json();
  if (!session_id || !qr_token) {
    return NextResponse.json({ error: 'session_id and qr_token are required.' }, { status: 400 });
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
    return NextResponse.json({ error: 'This session has already ended.' }, { status: 409 });
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, full_name, roll_number, section_id, active')
    .eq('qr_token', qr_token)
    .maybeSingle();

  if (studentError || !student) {
    return NextResponse.json({ error: 'QR code not recognized.' }, { status: 404 });
  }

  if (!student.active) {
    return NextResponse.json({ error: `${student.full_name} is not an active student.` }, { status: 400 });
  }

  if (student.section_id !== session.section_id) {
    return NextResponse.json(
      { error: `${student.full_name} is not in this section — wrong kiosk?` },
      { status: 400 }
    );
  }

  // Upsert: a repeat scan of the same student just refreshes
  // scanned_at rather than erroring or double-counting.
  const { error: upsertError } = await supabase
    .from('attendance_records')
    .upsert(
      {
        session_id,
        student_id: student.id,
        status: 'P',
        source: 'scan',
        scanned_at: new Date().toISOString(),
        marked_by: user.id,
      },
      { onConflict: 'session_id,student_id' }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    full_name: student.full_name,
    roll_number: student.roll_number,
  });
}
