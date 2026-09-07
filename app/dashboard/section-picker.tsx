'use client';

import { useRouter } from 'next/navigation';
import styles from './dashboard.module.css';

export function SectionPicker({
  sections,
  selected,
}: {
  sections: { id: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();

  return (
    <select
      className={styles.select}
      value={selected}
      onChange={(e) => router.push(`/dashboard?section=${e.target.value}`)}
    >
      {sections.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
