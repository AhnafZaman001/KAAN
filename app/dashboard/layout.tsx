import { SignOutButton } from './sign-out-button';
import { DashboardNav } from './nav';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className={styles.header}>
        <div className={styles.left}>
          <span className={styles.wordmark}>KAAN</span>
          <DashboardNav />
        </div>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
