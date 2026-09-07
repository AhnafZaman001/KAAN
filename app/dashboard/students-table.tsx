'use client';

import { useState, useMemo } from 'react';
import styles from './dashboard.module.css';

type Student = { roll_number: string; full_name: string };

export function StudentsTable({ students }: { students: Student[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    return students.filter(
      (s) => s.full_name.toLowerCase().includes(q) || s.roll_number.includes(q)
    );
  }, [students, query]);

  return (
    <>
      <div className={styles.controls}>
        <input
          type="text"
          placeholder="Search by name or roll number…"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>No students match "{query}".</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Roll No.</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.roll_number}>
                <td className={styles.rollNumber}>{s.roll_number}</td>
                <td>{s.full_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className={styles.resultCount}>
        {filtered.length} of {students.length} students
      </p>
    </>
  );
}
