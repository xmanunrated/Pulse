import { apiResponse, authenticateRequest } from '../../../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ farmerId: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { farmerId } = await context.params;
  if (!validUuid(farmerId)) return apiResponse({ message: 'Farmer ID must be a UUID.' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || !('orgId' in body) || !validUuid(String(body.orgId))) {
    return apiResponse({ message: 'orgId must be a UUID.' }, 400);
  }
  const orgId = String(body.orgId);
  const source = 'source' in body && typeof body.source === 'string'
    ? body.source.slice(0, 80)
    : 'workspace_operator';
  const membership = await requireOrganizationRole(auth, orgId, ['owner', 'admin', 'auditor']);
  if (!membership.ok) return membership.response;

  const { data: farmer, error: farmerError } = await auth.client.from('faa_farmers')
    .select('id, do_not_call, opted_out_at, opt_out_source')
    .eq('id', farmerId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (farmerError) return apiResponse({ message: 'Could not find the farmer record.' }, 500);
  if (!farmer) return apiResponse({ message: 'Farmer record not found.' }, 404);

  const farmerUpdate = farmer.do_not_call
    ? Promise.resolve({ data: { opted_out_at: farmer.opted_out_at }, error: null })
    : auth.client.from('faa_farmers').update({
      do_not_call: true,
      opted_out_at: new Date().toISOString(),
      opt_out_source: source,
    }).eq('id', farmerId).eq('org_id', orgId).eq('do_not_call', false).select('opted_out_at').maybeSingle();
  const [{ data: updatedFarmer, error: farmerUpdateError }, { data: participants, error: participantsError }] = await Promise.all([
    farmerUpdate,
    auth.client.from('faa_activity_participants').select('id')
      .eq('org_id', orgId)
      .eq('farmer_id', farmerId),
  ]);
  if (farmerUpdateError || participantsError) {
    return apiResponse({ message: 'Could not record opt-out. No new calls may be prepared until this is resolved.' }, 500);
  }
  let optedOutAt = updatedFarmer?.opted_out_at ?? farmer.opted_out_at;
  if (!optedOutAt) {
    const { data: currentFarmer, error: currentFarmerError } = await auth.client.from('faa_farmers')
      .select('opted_out_at, opt_out_source')
      .eq('id', farmerId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (currentFarmerError || !currentFarmer) return apiResponse({ message: 'Opt-out was applied, but its timestamp could not be verified.' }, 500);
    optedOutAt = currentFarmer.opted_out_at ?? new Date().toISOString();
  }

  const participantIds = (participants ?? []).map((item) => item.id);
  if (participantIds.length) {
    const { error: participantUpdateError } = await auth.client.from('faa_activity_participants')
      .update({ consent_status: 'withdrawn' })
      .eq('org_id', orgId)
      .in('id', participantIds);
    if (participantUpdateError) return apiResponse({ message: 'Opt-out is stored, but existing activity eligibility could not be updated. Stop the call queue and review it.' }, 500);

    const { error: callsError } = await auth.client.from('faa_audit_calls')
      .update({ status: 'cancelled' })
      .eq('org_id', orgId)
      .in('participant_id', participantIds)
      .in('status', ['queued', 'scheduled']);
    if (callsError) return apiResponse({ message: 'Opt-out is stored, but queued calls could not be cancelled. Stop the call queue and review it.' }, 500);
  }

  const { error: eventError } = await auth.client.from('faa_audit_events').insert({
    org_id: orgId,
    actor_id: auth.userId,
    event_type: 'farmer.opted_out',
    entity_type: 'farmer',
    entity_id: farmerId,
    details: { source: farmer.do_not_call ? farmer.opt_out_source ?? source : source, opted_out_at: optedOutAt, pending_calls_cancelled: true },
  });
  if (eventError) return apiResponse({ message: 'Opt-out was applied, but the audit event could not be recorded. Stop the call queue and review it.' }, 500);

  return apiResponse({ accepted: true, data: { farmerId, doNotCall: true, optedOutAt } });
}
