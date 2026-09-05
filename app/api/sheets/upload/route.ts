import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateSpec, processSheetImage } from '@/lib/ocr-service';

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
    .select('school_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.school_id) {
    return NextResponse.json(
      { error: 'Your account is not linked to a school. Contact your admin.' },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const imageFile = formData.get('image') as File | null;
  const sectionId = formData.get('section_id') as string | null;
  const attendanceDate = formData.get('attendance_date') as string | null;

  if (!imageFile || !sectionId || !attendanceDate) {
    return NextResponse.json(
      { error: 'image, section_id, and attendance_date are all required.' },
      { status: 400 }
    );
  }

  // RLS-scoped — fails naturally if this section belongs to another school
  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id, name, school_id, schools(name)')
    .eq('id', sectionId)
    .single();

  if (sectionError || !section) {
    return NextResponse.json({ error: 'Section not found.' }, { status: 404 });
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, roll_number, full_name')
    .eq('section_id', sectionId)
    .eq('active', true)
    .order('roll_number');

  if (studentsError || !students || students.length === 0) {
    return NextResponse.json(
      { error: 'No active students found for this section.' },
      { status: 400 }
    );
  }

  const rollToStudentId = new Map(students.map((s) => [s.roll_number, s.id]));

  // ---- 1. Upload the photo to Storage ----
  const storagePath = `${profile.school_id}/${sectionId}/${attendanceDate}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('attendance-sheets')
    .upload(storagePath, imageFile, { upsert: false, contentType: imageFile.type });

  if (uploadError) {
    if (uploadError.message.includes('already exists')) {
      return NextResponse.json(
        { error: 'A sheet for this section and date has already been uploaded.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // ---- 2. Create the sheet record ----
  const { data: sheet, error: sheetError } = await supabase
    .from('sheets')
    .insert({
      school_id: profile.school_id,
      section_id: sectionId,
      attendance_date: attendanceDate,
      image_url: storagePath,
      status: 'processing',
      uploaded_by: user.id,
    })
    .select('id')
    .single();

  if (sheetError || !sheet) {
    return NextResponse.json(
      { error: sheetError?.message ?? 'Could not create sheet record.' },
      { status: 500 }
    );
  }

  // ---- 3. Regenerate the matching coordinate spec ----
  // Deterministic from roster order, so this lines up with
  // whatever was printed — as long as the roster hasn't changed
  // between print time and now.
  const schoolName = (section as any).schools?.name ?? 'School';
  let spec;
  try {
    spec = await generateSpec({
      students: students.map((s) => ({ roll_number: s.roll_number, full_name: s.full_name })),
      school_name: schoolName,
      section_name: section.name,
      attendance_date: attendanceDate,
    });
  } catch (err: any) {
    await supabase.from('sheets').update({ status: 'uploaded' }).eq('id', sheet.id);
    return NextResponse.json({ error: `Could not prepare sheet spec: ${err.message}` }, { status: 502 });
  }

  // ---- 4. Run OCR ----
  let results;
  try {
    results = await processSheetImage(imageFile, spec);
  } catch (err: any) {
    await supabase.from('sheets').update({ status: 'uploaded' }).eq('id', sheet.id);
    return NextResponse.json(
      { error: `Could not read the sheet: ${err.message}. Try retaking the photo with all 4 corners visible and good lighting.` },
      { status: 422 }
    );
  }

  // ---- 5. Write attendance records ----
  const records = results
    .map((r) => {
      const studentId = rollToStudentId.get(r.roll_number);
      if (!studentId) return null;

      // 'blank' and 'unclear' aren't valid final attendance_status
      // values — they always need a human decision, so store them
      // provisionally as null-ish via needs_review and leave status
      // as the closest guess for the reviewer to correct, defaulting
      // unreadable marks to 'A' as the safer assumption pending review.
      const status = r.status === 'P' || r.status === 'A' || r.status === 'M' ? r.status : 'A';

      return {
        sheet_id: sheet.id,
        student_id: studentId,
        status,
        confidence: r.confidence,
        needs_review: r.needs_review,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { error: insertError } = await supabase.from('attendance_records').insert(records);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const needsReviewCount = records.filter((r) => r.needs_review).length;
  const finalStatus = needsReviewCount > 0 ? 'needs_review' : 'completed';

  await supabase.from('sheets').update({ status: finalStatus }).eq('id', sheet.id);

  return NextResponse.json({
    sheet_id: sheet.id,
    total: records.length,
    needs_review: needsReviewCount,
  });
}
