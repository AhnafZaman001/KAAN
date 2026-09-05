import { getSections } from '../get-sections';
import { UploadSheetForm } from './upload-sheet-form';
import styles from '../sheets.module.css';

export default async function UploadSheetPage() {
  const { sections } = await getSections();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Upload a sheet</h1>
      <p className={styles.subtitle}>
        Photograph the marked sheet with all 4 corner squares clearly
        visible, then upload it here. It'll be read automatically and
        posted — anything unclear gets sent to the review queue instead
        of guessed.
      </p>

      <UploadSheetForm sections={sections} />
    </main>
  );
}
