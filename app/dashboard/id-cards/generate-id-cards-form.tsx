'use client';

import { useState, type FormEvent } from 'react';
import styles from './id-cards.module.css';

export function GenerateIdCardsForm({ sections }: { sections: { id: string; name: string }[] }) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/id-cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_id: sectionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not generate ID cards.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'id_cards.pdf';
      a.click();
      URL.revokeObjectURL(url);
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

      <button type="submit" className={styles.submit} disabled={loading}>
        {loading ? 'Generating…' : 'Generate & download PDF'}
      </button>
    </form>
  );
}
