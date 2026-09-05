import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateSheetPdf } from '@/lib/ocr-service';

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { section_id } = await request.json();
  if (!section_id) {
    return NextResponse.json({ error: 'section_id is required.' }, { status: 400 });
  }

  // RLS scopes this to the caller's own school automatically —
  // a user from another school can't fetch a foreign section here.
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id, name, school_id, schools(name)')
    .eq('id', section_id)
    .single();

  if (sectionError || !section) {
    return NextResponse.json({ error: 'Section not found.' }, { status: 404 });
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('roll_number, full_name')
    .eq('section_id', section_id)
    .eq('active', true)
    .order('roll_number');

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 });
  }

  if (!students || students.length === 0) {
    return NextResponse.json(
      { error: 'This section has no active students to generate a sheet for.' },
      { status: 400 }
    );
  }

  const schoolName = (section as any).schools?.name ?? 'School';

  try {
    const { pdfBase64 } = await generateSheetPdf({
      students,
      school_name: schoolName,
      section_name: section.name,
      attendance_date: '',
    });

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="attendance_${section.name}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
