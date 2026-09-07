import { createClient } from '@/lib/supabase/server';
import { getSections } from './get-sections';
import { SectionPicker } from './section-picker';
import { StudentsTable } from './students-table';
import { StatCard } from './stat-card';
import styles from './dashboard.module.css';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { section?: string };
}) {
  const supabase = createClient();
  const { sections } = await getSections();

  const selectedSectionId = searchParams.section ?? sections[0]?.id ?? '';

  // Count-only queries (head: true) — don't transfer rows just to
  // count them. Matters once a school has 1800+ students; a plain
  // unfiltered `select *` here would pull the whole roster into
  // memory just to render a number.
  const { count: totalStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('active', true);

  const { data: students, error } = selectedSectionId
    ? await supabase
        .from('students')
        .select('roll_number, full_name')
        .eq('section_id', selectedSectionId)
        .eq('active', true)
        .order('roll_number')
    : { data: [], error: null };

  return (
    <main className={styles.main}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Students</h1>
          <p className={styles.subtitle}>Browse your school's roster, one section at a time.</p>
        </div>
      </div>

      <div className={styles.statsRow}>
        <StatCard value={totalStudents ?? 0} label="students (school-wide)" />
        <StatCard value={sections.length} label="sections" />
        <StatCard value={students?.length ?? 0} label="in selected section" />
      </div>

      {sections.length === 0 ? (
        <div className={styles.empty}>No sections found for your school yet.</div>
      ) : (
        <>
          <div className={styles.controls}>
            <SectionPicker sections={sections} selected={selectedSectionId} />
          </div>

          {error && <div className={styles.empty}>Couldn't load students: {error.message}</div>}

          {!error && <StudentsTable students={students ?? []} />}
        </>
      )}
    </main>
  );
}
