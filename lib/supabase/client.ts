import { createBrowserClient } from "@supabase/ssr";

// Shared browser-side Supabase client.
// Reads the project URL and publishable key from .env.local (and from Vercel's
// environment variables once the app is deployed).

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase environment variables are missing. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart the dev server."
    );
  }

  return createBrowserClient(url, key);
}
