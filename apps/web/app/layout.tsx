import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FieldLens AI — Farmer Activity Audit', description: 'AI-assisted field activity verification and farmer audit workspace' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
