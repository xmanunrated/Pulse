import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

type AuthenticatedRequest = {
  ok: true;
  client: SupabaseClient;
  userId: string;
} | {
  ok: false;
  response: NextResponse;
};

export function apiResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function authenticateRequest(request: Request): Promise<AuthenticatedRequest> {
  const authorization = request.headers.get('authorization');
  const match = authorization ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null;
  if (!match) {
    return { ok: false, response: apiResponse({ message: 'A Supabase access token is required.' }, 401) };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return { ok: false, response: apiResponse({ message: 'Supabase API access is not configured.' }, 503) };
  }

  const accessToken = match[1];
  const client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return { ok: false, response: apiResponse({ message: 'The Supabase access token is invalid or expired.' }, 401) };
  }

  return { ok: true, client, userId: data.user.id };
}

