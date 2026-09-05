'use client';

import { useState, useTransition } from 'react';
import { confirmMark } from './actions';
import styles from './review.module.css';

type Props = {
  recordId: string;
  fullName: string;
  rollNumber: string;
  sectionName: string;
  attendanceDate: string;
  predictedStatus: 'P' | 'A' | 'M';
  confidence: number;
};

export function ReviewRow({
  recordId,
  fullName,
  rollNumber,
  sectionName,
  attendanceDate,
  predictedStatus,
  confidence,
}: Props) {
  const [selected, setSelected] = useState<'P' | 'A' | 'M'>(predictedStatus);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmMark(recordId, selected);
      if (result.success) {
        setDone(true);
      }
    });
  }

  if (done) return null;

  return (
    <div className={styles.row}>
      <div className={styles.rowInfo}>
        <span className={styles.rowName}>
          {fullName} <span className={styles.confidence}>({rollNumber})</span>
        </span>
        <span className={styles.rowMeta}>
          {sectionName} · {attendanceDate} · OCR read: {predictedStatus} (
          {Math.round(confidence * 100)}% confidence)
        </span>
      </div>

      <div className={styles.rowActions}>
        {(['P', 'A', 'M'] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`${styles.statusButton} ${
              selected === status ? styles.statusButtonSelected : ''
            }`}
            onClick={() => setSelected(status)}
          >
            {status}
          </button>
        ))}
        <button
          type="button"
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? '…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
