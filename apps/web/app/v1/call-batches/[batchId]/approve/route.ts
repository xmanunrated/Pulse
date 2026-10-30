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
  const membership = await requireOrganizationRole(auth, orgId, ['owner', 'admin', 'reviewer']);
  if (!membership.ok) return membership.response;

  const { data: batch, error: batchError } = await auth.client.from('faa_sampling_batches')
    .select('id, org_id, activity_id, status')
    .eq('id', batchId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (batchError) return apiResponse({ message: 'Could not load the call batch.' }, 500);
  if (!batch) return apiResponse({ message: 'Call batch not found.' }, 404);
  if (batch.status !== 'draft') return apiResponse({ message: 'Only a draft batch can be approved.' }, 409);

  const { data: calls, error: callsError } = await auth.client.from('faa_audit_calls')
    .select('id, participant_id, knowledge_version_id')
    .eq('sampling_batch_id', batchId)
    .eq('org_id', orgId);
  if (callsError || !calls?.length) return apiResponse({ message: 'Call batch has no staged participants.' }, 409);

  const knowledgeIds = [...new Set(calls.map((call) => call.knowledge_version_id).filter((id): id is string => Boolean(id)))];
  const [{ data: participants, error: participantError }, { data: knowledge, error: knowledgeError }] = await Promise.all([
    auth.client.from('faa_activity_participants')
      .select('id, consent_status, consent_method, consent_source, consent_purpose, consent_at, consent_evidence_ref, faa_farmers!inner(do_not_call, phone_encrypted)')
      .eq('org_id', orgId)
      .in('id', calls.map((call) => call.participant_id)),
    auth.client.from('faa_product_knowledge_versions')
      .select('id, status, source_refs, content_json')
      .eq('org_id', orgId)
      .in('id', knowledgeIds),
  ]);
  if (participantError || knowledgeError) return apiResponse({ message: 'Could not recheck consent and approved knowledge.' }, 500);

  const participantById = new Map((participants ?? []).map((item) => [item.id, item]));
  const allEligible = calls.every((call) => {
    const participant = participantById.get(call.participant_id);
    const farmer = participant && (Array.isArray(participant.faa_farmers) ? participant.faa_farmers[0] : participant.faa_farmers);
    return Boolean(participant?.consent_status === 'eligible' && participant.consent_method && participant.consent_source?.trim()
      && participant.consent_purpose?.trim() && participant.consent_at && participant.consent_evidence_ref?.trim()
      && farmer && !farmer.do_not_call && farmer.phone_encrypted);
  });
  const knowledgeById = new Map((knowledge ?? []).map((item) => [item.id, item]));
  const allKnowledgeApproved = calls.every((call) => {
    if (!call.knowledge_version_id) return false;
    const version = knowledgeById.get(call.knowledge_version_id);
    const claims = version?.content_json && typeof version.content_json === 'object'
      ? (version.content_json as { claims?: unknown }).claims
      : null;
    return Boolean(version?.status === 'approved' && Array.isArray(version.source_refs) && version.source_refs.length && Array.isArray(claims) && claims.length);
  });
  if (!allEligible || !allKnowledgeApproved) {
    return apiResponse({ message: 'Batch approval stopped because consent or approved source-backed knowledge changed.' }, 409);
  }

  const { data, error } = await auth.client.from('faa_sampling_batches').update({
    status: 'approved',
    approved_by: auth.userId,
    approved_at: new Date().toISOString(),
  }).eq('id', batchId).eq('org_id', orgId).eq('status', 'draft')
    .select('id, activity_id, sample_size, status, approved_by, approved_at')
    .maybeSingle();
  if (error || !data) return apiResponse({ message: 'Could not approve this batch.' }, 409);

  const { error: eventError } = await auth.client.from('faa_audit_events').insert({
    org_id: orgId,
    actor_id: auth.userId,
    event_type: 'call_batch.approved',
    entity_type: 'sampling_batch',
    entity_id: batchId,
    details: { participant_count: calls.length, live_dispatch: false },
  });
  if (eventError) return apiResponse({ message: 'Batch was approved, but its audit event could not be recorded. No calls were placed.' }, 500);
  return apiResponse({ data: { ...data, dispatchEnabled: false }, message: 'Batch approved for a future reviewed dispatch. No calls were placed.' });
}
