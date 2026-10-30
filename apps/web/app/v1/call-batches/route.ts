import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';
import { requireOrganizationRole } from '../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const createBatchSchema = z.object({
  orgId: z.string().uuid(),
  activityId: z.string().uuid(),
  productId: z.string().uuid(),
  knowledgeVersionId: z.string().uuid(),
  sampleSize: z.number().int().min(1).max(100),
}).strict();

function rank(seed: string, id: string): string {
  // Hashing a private seed keeps the selected sample reproducible without sorting by PII.
  let hash = 2166136261;
  for (const char of `${seed}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${id}`;
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const orgId = new URL(request.url).searchParams.get('orgId');
  if (!orgId || !z.string().uuid().safeParse(orgId).success) return apiResponse({ message: 'orgId must be a UUID.' }, 400);

  const { data, error } = await auth.client.from('faa_sampling_batches')
    .select('id, org_id, activity_id, sample_size, method, seed, status, approved_by, approved_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return apiResponse({ message: 'Could not load call batches.' }, 500);
  const ids = (data ?? []).map((batch) => batch.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: calls, error: callsError } = await auth.client.from('faa_audit_calls')
      .select('sampling_batch_id, status')
      .eq('org_id', orgId)
      .in('sampling_batch_id', ids);
    if (callsError) return apiResponse({ message: 'Could not load call batch counts.' }, 500);
    for (const call of calls ?? []) counts.set(call.sampling_batch_id, (counts.get(call.sampling_batch_id) ?? 0) + 1);
  }
  return apiResponse({ data: (data ?? []).map((batch) => ({ ...batch, callsCount: counts.get(batch.id) ?? 0, dispatchEnabled: false })) });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  const parsed = createBatchSchema.safeParse(body);
  if (!parsed.success) return apiResponse({ message: 'Activity, product, approved knowledge and sample size are required.' }, 400);
  const input = parsed.data;
  const membership = await requireOrganizationRole(auth, input.orgId, ['owner', 'admin', 'auditor']);
  if (!membership.ok) return membership.response;

  const [{ data: activity, error: activityError }, { data: product, error: productError }, { data: knowledge, error: knowledgeError }] = await Promise.all([
    auth.client.from('faa_activities').select('id').eq('id', input.activityId).eq('org_id', input.orgId).maybeSingle(),
    auth.client.from('faa_products').select('id').eq('id', input.productId).eq('org_id', input.orgId).maybeSingle(),
    auth.client.from('faa_product_knowledge_versions').select('id, product_id, status, content_json, source_refs')
      .eq('id', input.knowledgeVersionId).eq('org_id', input.orgId).maybeSingle(),
  ]);
  if (activityError || productError || knowledgeError) return apiResponse({ message: 'Could not verify the selected audit inputs.' }, 500);
  if (!activity || !product || !knowledge || knowledge.product_id !== input.productId) {
    return apiResponse({ message: 'The selected audit inputs must belong to this organization.' }, 404);
  }
  const claims = knowledge.content_json && typeof knowledge.content_json === 'object'
    ? (knowledge.content_json as { claims?: unknown }).claims
    : null;
  if (knowledge.status !== 'approved' || !Array.isArray(knowledge.source_refs) || knowledge.source_refs.length === 0 || !Array.isArray(claims) || claims.length === 0) {
    return apiResponse({ message: 'Approve a source-backed knowledge version before sampling.' }, 409);
  }

  const { data: participants, error: participantError } = await auth.client.from('faa_activity_participants')
    .select('id, farmer_id, consent_method, consent_source, consent_purpose, consent_at, consent_evidence_ref, faa_farmers!inner(do_not_call, phone_encrypted)')
    .eq('org_id', input.orgId)
    .eq('activity_id', input.activityId)
    .eq('product_id', input.productId)
    .eq('consent_status', 'eligible')
    .eq('faa_farmers.do_not_call', false)
    .not('consent_method', 'is', null)
    .not('consent_source', 'is', null)
    .not('consent_purpose', 'is', null)
    .not('consent_at', 'is', null)
    .not('consent_evidence_ref', 'is', null)
    .not('faa_farmers.phone_encrypted', 'is', null)
    .limit(5000);
  if (participantError) return apiResponse({ message: 'Could not verify call eligibility. Apply the farmer import migration first.' }, 503);

  const eligible = (participants ?? []).filter((item) => {
    const farmer = Array.isArray(item.faa_farmers) ? item.faa_farmers[0] : item.faa_farmers;
    return Boolean(item.consent_method && item.consent_source?.trim() && item.consent_purpose?.trim() && item.consent_at && item.consent_evidence_ref?.trim() && farmer && !farmer.do_not_call && farmer.phone_encrypted);
  });
  if (eligible.length === 0) return apiResponse({ message: 'No eligible participants were found. Unknown, opted-out, and incomplete consent records are excluded.' }, 409);

  const seed = randomUUID();
  const selected = [...eligible].sort((left, right) => rank(seed, left.id).localeCompare(rank(seed, right.id))).slice(0, input.sampleSize);
  const { data: batch, error: batchError } = await auth.client.from('faa_sampling_batches').insert({
    org_id: input.orgId,
    activity_id: input.activityId,
    sample_size: selected.length,
    method: 'simple_random',
    seed,
    status: 'draft',
    created_by: auth.userId,
  }).select('id, activity_id, sample_size, method, seed, status, created_at').single();
  if (batchError) return apiResponse({ message: 'Could not save the draft call batch.' }, 500);

  const { error: callsError } = await auth.client.from('faa_audit_calls').insert(selected.map((participant) => ({
    org_id: input.orgId,
    sampling_batch_id: batch.id,
    participant_id: participant.id,
    knowledge_version_id: input.knowledgeVersionId,
    status: 'queued',
    attempt_number: 1,
  })));
  if (callsError) {
    await auth.client.from('faa_sampling_batches').update({ status: 'cancelled' }).eq('id', batch.id).eq('org_id', input.orgId);
    return apiResponse({ message: 'Could not stage the selected call records. No calls were placed.' }, 500);
  }

  const { error: eventError } = await auth.client.from('faa_audit_events').insert({
    org_id: input.orgId,
    actor_id: auth.userId,
    event_type: 'call_batch.drafted',
    entity_type: 'sampling_batch',
    entity_id: batch.id,
    details: { activity_id: input.activityId, product_id: input.productId, knowledge_version_id: input.knowledgeVersionId, sample_size: selected.length },
  });
  if (eventError) return apiResponse({ message: 'Draft batch was staged, but its audit event could not be recorded. No calls were placed.' }, 500);

  return apiResponse({
    data: { ...batch, knowledgeVersionId: input.knowledgeVersionId, callsCount: selected.length, dispatchEnabled: false },
    message: 'Draft sample created. This action does not start or place calls.',
  }, 201);
}
