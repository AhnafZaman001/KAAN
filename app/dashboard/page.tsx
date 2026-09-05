import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';
import styles from './dashboard.module.css';

export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If this returns rows, auth + RLS + profiles are all wired
  // correctly end to end. If it returns [], the profiles row
  // is missing or has the wrong school_id/role.
  const { data: students, error } = await supabase
    .from('students')
    .select('roll_number, full_name')
    .order('roll_number');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>KAAN</span>
        <SignOutButton />
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Students</h1>
        <p className={styles.subtitle}>
          Signed in as {user?.email}. This list comes straight from
          Supabase through your logged-in session — if it's populated,
          auth and RLS are working together correctly.
        </p>

        {error && (
          <div className={styles.empty}>
            Couldn't load students: {error.message}
          </div>
        )}

        {!error && students && students.length === 0 && (
          <div className={styles.empty}>
            No students visible. Check that your profiles row has the
            correct school_id and role — RLS is likely blocking
            everything until that's set correctly.
          </div>
        )}

        {!error && students && students.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Roll No.</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.roll_number}>
                  <td className={styles.rollNumber}>{s.roll_number}</td>
                  <td>{s.full_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
