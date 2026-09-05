'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../sheets.module.css';

export function UploadSheetForm({ sections }: { sections: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ total: number; needs_review: number } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError('Choose a photo of the sheet first.');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('section_id', sectionId);
      formData.append('attendance_date', date);

      const res = await fetch('/api/sheets/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Could not process the sheet.');
      }

      setResult({ total: data.total, needs_review: data.needs_review });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (sections.length === 0) {
    return <div className={styles.error}>No sections found for your school yet.</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <div className={styles.success}>
          Processed {result.total} students.{' '}
          {result.needs_review > 0
            ? `${result.needs_review} mark${result.needs_review === 1 ? '' : 's'} need${
                result.needs_review === 1 ? 's' : ''
              } review.`
            : 'Everything was read with high confidence — nothing to review.'}
          {result.needs_review > 0 && (
            <>
              {' '}
              <a href="/dashboard/review" style={{ color: 'inherit', fontWeight: 600 }}>
                Go to review queue →
              </a>
            </>
          )}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="section">
          Section
        </label>
        <select
          id="section"
          className={styles.select}
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="date">
          Attendance date
        </label>
        <input
          id="date"
          type="date"
          className={styles.input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="photo">
          Photo of the marked sheet
        </label>
        <input
          id="photo"
          type="file"
          accept="image/*"
          capture="environment"
          className={styles.fileInput}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <button type="submit" className={styles.submit} disabled={loading}>
        {loading ? 'Processing…' : 'Upload & process'}
      </button>
    </form>
  );
}
