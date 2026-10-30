import { apiResponse, authenticateRequest } from '../../../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { versionId } = await context.params;
  if (!validUuid(versionId)) return apiResponse({ message: 'Knowledge version ID must be a UUID.' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || !('orgId' in body) || !validUuid(String(body.orgId))) {
    return apiResponse({ message: 'orgId must be a UUID.' }, 400);
  }
  const orgId = String(body.orgId);
  const membership = await requireOrganizationRole(auth, orgId, ['owner', 'admin', 'reviewer']);
  if (!membership.ok) return membership.response;

  const { data: version, error: versionError } = await auth.client.from('faa_product_knowledge_versions')
    .select('id, org_id, product_id, version, status, content_json, source_refs')
    .eq('id', versionId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (versionError) return apiResponse({ message: 'Could not load the knowledge version.' }, 500);
  if (!version) return apiResponse({ message: 'Knowledge version not found.' }, 404);
  const claims = version.content_json && typeof version.content_json === 'object'
    ? (version.content_json as { claims?: unknown }).claims
    : null;
  if (version.status !== 'draft' && version.status !== 'in_review') {
    return apiResponse({ message: 'Only a draft or in-review version can be approved.' }, 409);
  }
  if (!Array.isArray(claims) || claims.length === 0 || !Array.isArray(version.source_refs) || version.source_refs.length === 0) {
    return apiResponse({ message: 'A source-backed claim is required before approval.' }, 409);
  }

  const { data, error } = await auth.client.from('faa_product_knowledge_versions').update({
    status: 'approved',
    approved_by: auth.userId,
    approved_at: new Date().toISOString(),
  }).eq('id', versionId).eq('org_id', orgId).eq('status', version.status)
    .select('id, product_id, version, status, approved_by, approved_at')
    .maybeSingle();
  if (error || !data) return apiResponse({ message: 'Could not approve this knowledge version.' }, 409);

  const { error: auditError } = await auth.client.from('faa_audit_events').insert({
    org_id: orgId,
    actor_id: auth.userId,
    event_type: 'knowledge.version_approved',
    entity_type: 'knowledge_version',
    entity_id: versionId,
    details: { product_id: version.product_id, version: version.version },
  });
  if (auditError) return apiResponse({ message: 'Knowledge was approved, but its audit event could not be recorded. Review the approval trail before proceeding.' }, 500);
  return apiResponse({ data, message: 'Knowledge version approved.' });
}
