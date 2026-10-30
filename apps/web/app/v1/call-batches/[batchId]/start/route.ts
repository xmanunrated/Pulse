import { apiResponse, authenticateRequest } from '../../../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { batchId } = await context.params;
  if (!validUuid(batchId)) return apiResponse({ message: 'Batch ID must be a UUID.' }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || !('orgId' in body) || !validUuid(String(body.orgId))) {
    return apiResponse({ message: 'orgId must be a UUID.' }, 400);
  }
  const orgId = String(body.orgId);
  const membership = await requireOrganizationRole(auth, orgId, ['owner', 'admin']);
  if (!membership.ok) return membership.response;

  const { data: batch, error } = await auth.client.from('faa_sampling_batches')
    .select('id, status')
    .eq('id', batchId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) return apiResponse({ message: 'Could not load the call batch.' }, 500);
  if (!batch) return apiResponse({ message: 'Call batch not found.' }, 404);
  if (batch.status !== 'approved') return apiResponse({ message: 'Approve the draft batch before requesting dispatch.' }, 409);

  // The provider, account authorization, compliance checks and live-dispatch controls are not configured.
  // Keep this endpoint fail-closed until those independent gates are implemented and reviewed.
  return apiResponse({
    code: 'LIVE_CALLING_DISABLED',
    message: 'No calls were placed. Live dispatch is disabled until the India telecom setup, provider account, consent verification and call controls are complete.',
  }, 409);
}
