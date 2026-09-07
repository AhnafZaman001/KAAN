'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './layout.module.css';

const LINKS = [
  { href: '/dashboard', label: 'Students' },
  { href: '/dashboard/id-cards', label: 'ID cards' },
  { href: '/dashboard/kiosk', label: 'Kiosk' },
  { href: '/dashboard/health', label: 'Health' },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`${styles.navLink} ${pathname === link.href ? styles.navLinkActive : ''}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
