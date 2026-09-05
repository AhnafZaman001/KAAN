import { getSections } from '../get-sections';
import { GenerateSheetForm } from './generate-sheet-form';
import styles from '../sheets.module.css';

export default async function NewSheetPage() {
  const { sections } = await getSections();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Print a sheet</h1>
      <p className={styles.subtitle}>
        Generates a fresh grid-format attendance sheet from the section's
        current roster. Print it, have the teacher mark it during first
        lecture, then upload a photo of it under "Upload sheet".
      </p>

      <GenerateSheetForm sections={sections} />
    </main>
  );
}
