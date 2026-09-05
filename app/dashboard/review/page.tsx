import { createClient } from '@/lib/supabase/server';
import { ReviewRow } from './review-row';
import styles from './review.module.css';

export default async function ReviewPage() {
  const supabase = createClient();

  const { data: records, error } = await supabase
    .from('attendance_records')
    .select(
      `
      id,
      status,
      confidence,
      students ( roll_number, full_name ),
      sheets ( attendance_date, sections ( name ) )
    `
    )
    .eq('needs_review', true)
    .order('created_at');

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Review queue</h1>
      <p className={styles.subtitle}>
        Marks the OCR pipeline couldn't read confidently. Pick the correct
        value and confirm — this also trains the accuracy of future
        recalibration.
      </p>

      {error && <div className={styles.empty}>Couldn't load the review queue: {error.message}</div>}

      {!error && (!records || records.length === 0) && (
        <div className={styles.empty}>Nothing to review right now.</div>
      )}

      {!error &&
        records &&
        records.map((r: any) => (
          <ReviewRow
            key={r.id}
            recordId={r.id}
            fullName={r.students?.full_name ?? 'Unknown'}
            rollNumber={r.students?.roll_number ?? '—'}
            sectionName={r.sheets?.sections?.name ?? '—'}
            attendanceDate={r.sheets?.attendance_date ?? '—'}
            predictedStatus={r.status}
            confidence={r.confidence ?? 0}
          />
        ))}
    </main>
  );
}
