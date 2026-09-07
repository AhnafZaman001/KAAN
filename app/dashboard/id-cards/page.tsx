import { getSections } from '../get-sections';
import { GenerateIdCardsForm } from './generate-id-cards-form';
import styles from './id-cards.module.css';

export default async function IdCardsPage() {
  const { sections } = await getSections();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Print ID cards</h1>
      <p className={styles.subtitle}>
        Generates one QR-coded card per active student in a section, laid
        out for laminating. Each card's QR is a unique scan token — not the
        student's real ID — so a lost or damaged card can be reissued
        without affecting their records.
      </p>

      <GenerateIdCardsForm sections={sections} />
    </main>
  );
}
