import { createBrowserClient } from '@supabase/ssr';

// Used in Client Components ('use client'). Safe to call anywhere
// in the browser — the publishable key is meant to be public.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
