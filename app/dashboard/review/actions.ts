'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function confirmMark(recordId: string, finalStatus: 'P' | 'A' | 'M') {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not signed in.' };
  }

  const { data: record, error: fetchError } = await supabase
    .from('attendance_records')
    .select('status')
    .eq('id', recordId)
    .single();

  if (fetchError || !record) {
    return { error: 'Record not found.' };
  }

  // Only log a correction if the reviewer actually changed the
  // OCR's guess — confirming as-is isn't a correction.
  if (record.status !== finalStatus) {
    const { error: correctionError } = await supabase.from('attendance_corrections').insert({
      attendance_record_id: recordId,
      old_status: record.status,
      new_status: finalStatus,
      changed_by: user.id,
    });

    if (correctionError) {
      return { error: correctionError.message };
    }
  }

  const { error: updateError } = await supabase
    .from('attendance_records')
    .update({
      status: finalStatus,
      needs_review: false,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', recordId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath('/dashboard/review');
  return { success: true };
}
