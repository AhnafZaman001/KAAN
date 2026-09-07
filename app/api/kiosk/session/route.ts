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

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single();

  if (!profile?.school_id) {
    return NextResponse.json(
      { error: 'Your account is not linked to a school.' },
      { status: 403 }
    );
  }

  const { section_id, session_date } = await request.json();
  if (!section_id || !session_date) {
    return NextResponse.json(
      { error: 'section_id and session_date are required.' },
      { status: 400 }
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const userAgent = request.headers.get('user-agent');

  // Total active students in the section — used by the kiosk to show
  // a meaningful "X of Y scanned" confirmation before closing.
  const { count: totalActiveStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', section_id)
    .eq('active', true);

  const { data: existing } = await supabase
    .from('attendance_sessions')
    .select('id, status')
    .eq('section_id', section_id)
    .eq('session_date', session_date)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'closed') {
      return NextResponse.json(
        { error: 'This section already has a closed session for today.' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      session_id: existing.id,
      status: existing.status,
      total_active_students: totalActiveStudents ?? 0,
    });
  }

  const { data: created, error } = await supabase
    .from('attendance_sessions')
    .insert({
      school_id: profile.school_id,
      section_id,
      session_date,
      status: 'open',
      opened_by: user.id,
      opened_from_ip: ip,
      opened_user_agent: userAgent,
    })
    .select('id, status')
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'Could not open session.' }, { status: 500 });
  }

  return NextResponse.json({
    session_id: created.id,
    status: created.status,
    total_active_students: totalActiveStudents ?? 0,
  });
}
