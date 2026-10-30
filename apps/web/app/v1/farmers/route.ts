import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';
import { validUuid } from '../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const search = new URL(request.url).searchParams;
  const orgId = search.get('orgId');
  const activityId = search.get('activityId');
  const productId = search.get('productId');
  if (!validUuid(orgId) || !validUuid(activityId) || !validUuid(productId)) {
    return apiResponse({ message: 'orgId, activityId and productId must be UUIDs.' }, 400);
  }

  const { data, error } = await auth.client
    .from('faa_activity_participants')
    .select('id, farmer_id, consent_status, consent_method, consent_source, consent_purpose, consent_at, consent_evidence_ref, recording_consent_status, activity_id, product_id, faa_farmers!inner(id, full_name, external_ref, village, district, preferred_language, do_not_call)')
    .eq('org_id', orgId)
    .eq('activity_id', activityId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) return apiResponse({ message: 'Could not load the farmer register. Apply the farmer import migration first.' }, 503);

  const rows = (data ?? []).map((item) => {
    const farmer = Array.isArray(item.faa_farmers) ? item.faa_farmers[0] : item.faa_farmers;
    return {
      participantId: item.id,
      farmerId: item.farmer_id,
      consentStatus: item.consent_status,
      consentMethod: item.consent_method,
      consentAt: item.consent_at,
      hasConsentEvidence: Boolean(item.consent_evidence_ref),
      recordingConsentStatus: item.recording_consent_status,
      farmer: farmer ? {
        id: farmer.id,
        name: farmer.full_name,
        externalRef: farmer.external_ref,
        village: farmer.village,
        district: farmer.district,
        language: farmer.preferred_language,
        doNotCall: farmer.do_not_call,
      } : null,
    };
  });
  return apiResponse({ data: rows });
}
