import { createClient } from '@/lib/supabase/server';
import styles from './health.module.css';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes with no scan while "open" looks stuck

export default async function HealthPage() {
  const supabase = createClient();

  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('id, session_date, opened_at, sections ( id, name )')
    .eq('status', 'open')
    .order('opened_at');

  const rows = await Promise.all(
    (sessions ?? []).map(async (session: any) => {
      const [{ count: scannedCount }, { count: totalStudents }, { data: lastScan }] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', session.id)
          .eq('source', 'scan'),
        supabase
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('section_id', session.sections?.id)
          .eq('active', true),
        supabase
          .from('attendance_records')
          .select('scanned_at')
          .eq('session_id', session.id)
          .eq('source', 'scan')
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const lastScanTime = lastScan?.scanned_at ? new Date(lastScan.scanned_at) : null;
      const referenceTime = lastScanTime ?? new Date(session.opened_at);
      const msSinceActivity = Date.now() - referenceTime.getTime();
      const isStale = msSinceActivity > STALE_THRESHOLD_MS;

      return {
        sessionId: session.id,
        sectionName: session.sections?.name ?? 'Unknown section',
        openedAt: session.opened_at,
        scannedCount: scannedCount ?? 0,
        totalStudents: totalStudents ?? 0,
        lastScanTime,
        isStale,
      };
    })
  );

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Kiosk health</h1>
      <p className={styles.subtitle}>
        Sections with an active scanning session right now. A section with no scan
        in the last 5 minutes is flagged — could mean the kiosk stalled, lost the
        camera, or the class just hasn't started yet.
      </p>

      {error && <div className={styles.empty}>Couldn't load session data: {error.message}</div>}

      {!error && rows.length === 0 && (
        <div className={styles.empty}>No sections are actively scanning right now.</div>
      )}

      {!error &&
        rows.map((row) => (
          <div key={row.sessionId} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={`${styles.dot} ${row.isStale ? styles.dotStale : styles.dotOpen}`} />
              <div>
                <div className={styles.sectionName}>{row.sectionName}</div>
                <div className={styles.meta}>
                  {row.lastScanTime
                    ? `Last scan ${row.lastScanTime.toLocaleTimeString()}`
                    : `Opened ${new Date(row.openedAt).toLocaleTimeString()} — no scans yet`}
                </div>
              </div>
            </div>
            <div className={styles.progress}>
              {row.scannedCount} / {row.totalStudents}
            </div>
          </div>
        ))}
    </main>
  );
}
