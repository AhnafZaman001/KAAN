import { getSections } from '../get-sections';
import { KioskScanner } from './kiosk-scanner';
import styles from './kiosk.module.css';

export default async function KioskPage() {
  const { sections } = await getSections();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Kiosk</h1>
      <p className={styles.subtitle}>
        Pick the section meeting here, start the session, then let students
        scan their ID card as they walk in. Anyone who hasn't scanned by the
        time you end the session gets marked absent automatically.
      </p>

      {sections.length === 0 ? (
        <div className={styles.error}>No sections found for your school yet.</div>
      ) : (
        <KioskScanner sections={sections} />
      )}
    </main>
  );
}
