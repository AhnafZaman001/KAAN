'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './dashboard.module.css';

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button className={styles.signOut} onClick={handleSignOut}>
      Sign out
    </button>
  );
}
