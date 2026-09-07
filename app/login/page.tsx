'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Try again.'
          : signInError.message
      );
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className={styles.page}>
      <div className={styles.showcase}>
        <div className={styles.ledgerGrid} aria-hidden="true" />
        <span className={styles.wordmark}>KAAN</span>
        <div>
          <div className={styles.markRow}>
            <span className={styles.markPresent}>✓</span>
            <span className={styles.markName}>Ali Raza — Roll 101</span>
          </div>
          <div className={styles.markRow}>
            <span className={styles.markPresent}>✓</span>
            <span className={styles.markName}>Sara Khan — Roll 102</span>
          </div>
        </div>
        <p className={styles.showcaseFooter}>
          Every student scans in at the door — attendance recorded
          instantly, no paperwork afterward.
        </p>
      </div>

      <div className={styles.formSide}>
        <form className={styles.formCard} onSubmit={handleSubmit}>
          <h1 className={styles.formTitle}>Sign in</h1>
          <p className={styles.formSubtitle}>
            Use the account your school admin set up for you.
          </p>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
