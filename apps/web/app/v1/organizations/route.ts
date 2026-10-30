import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const { data: memberships, error: membershipError } = await auth.client
    .from('faa_organization_members')
    .select('org_id, role')
    .eq('user_id', auth.userId)
    .order('org_id')
    .limit(100);

  if (membershipError) {
    return apiResponse({ message: 'Could not load organization memberships.' }, 500);
  }
  if (!memberships?.length) return apiResponse({ data: [] });

  const { data: organizations, error: organizationError } = await auth.client
    .from('faa_organizations')
    .select('id, name')
    .in('id', memberships.map((membership) => membership.org_id))
    .order('name')
    .limit(100);

  if (organizationError) {
    return apiResponse({ message: 'Could not load organizations.' }, 500);
  }

  const roleByOrganization = new Map(memberships.map(({ org_id, role }) => [org_id, role]));
  return apiResponse({
    data: (organizations ?? []).map((organization) => ({
      ...organization,
      role: roleByOrganization.get(organization.id) ?? 'viewer',
    })),
  });
}

