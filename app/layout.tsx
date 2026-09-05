import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KAAN',
  description: 'Attendance digitization for KIPS College',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
