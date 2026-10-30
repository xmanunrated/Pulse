import type { SupabaseClient } from '@supabase/supabase-js';
import { apiResponse } from './faa-api-auth';

type OrganizationAccess = { client: SupabaseClient; userId: string };

export async function requireOrganizationRole(
  auth: OrganizationAccess,
  orgId: string,
  allowedRoles: readonly string[],
) {
  const { data, error } = await auth.client
    .from('faa_organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, response: apiResponse({ message: 'Could not verify organization membership.' }, 500) };
  }
  if (!data || !allowedRoles.includes(data.role)) {
    return { ok: false as const, response: apiResponse({ message: 'Your organization role does not allow that action.' }, 403) };
  }
  return { ok: true as const, role: data.role };
}

export function validUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
