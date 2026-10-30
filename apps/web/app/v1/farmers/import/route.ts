import { z } from 'zod';
import { apiResponse, authenticateRequest } from '../../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../../lib/faa-authorization';
import { MAX_FARMER_IMPORT_BYTES, MAX_FARMER_IMPORT_ROWS, parseCsv } from '../../../../lib/faa-csv';
import { encryptPhone, hashPhone, normalizeIndianPhone } from '../../../../lib/faa-pii';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const consentStatusSchema = z.enum(['unknown', 'eligible', 'declined', 'withdrawn', 'suppressed']);
const languageSchema = z.enum(['hi', 'bho', 'en', 'other']);
const recordingConsentSchema = z.enum(['unknown', 'granted', 'declined', 'not_applicable']);
const MAX_ERRORS = 50;
const consentMethods = new Set(['verbal', 'written', 'digital', 'partner_attestation']);

type ImportRow = {
  line: number;
  fullName: string | null;
  externalRef: string | null;
  phone: string;
  phoneHmac: string;
  phoneEncrypted: string;
  language: z.infer<typeof languageSchema>;
  village: string;
  district: string | null;
  state: string | null;
  consentStatus: z.infer<typeof consentStatusSchema>;
  consentMethod: string | null;
  consentSource: string | null;
  consentPurpose: string | null;
  consentAt: string | null;
  consentEvidenceRef: string | null;
  recordingConsentStatus: z.infer<typeof recordingConsentSchema>;
  recordingConsentAt: string | null;
  recordingConsentEvidenceRef: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function parseDate(value: string): string | null {
  if (!value || !/(Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) return null;
  return date.toISOString();
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiResponse({ message: 'Upload a CSV file using multipart form data.' }, 400);
  }

  const orgId = String(form.get('orgId') ?? '');
  const activityId = String(form.get('activityId') ?? '');
  const productId = String(form.get('productId') ?? '');
  const file = form.get('file');
  if (!validUuid(orgId) || !validUuid(activityId) || !validUuid(productId)) {
    return apiResponse({ message: 'Select a valid organization, activity and product.' }, 400);
  }
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) {
    return apiResponse({ message: 'Choose a CSV file.' }, 400);
  }
  if (file.size === 0 || file.size > MAX_FARMER_IMPORT_BYTES) {
    return apiResponse({ message: 'CSV must be between 1 byte and 4 MB.' }, 413);
  }

  const membership = await requireOrganizationRole(auth, orgId, ['owner', 'admin', 'auditor']);
  if (!membership.ok) return membership.response;

  const [{ data: activity, error: activityError }, { data: product, error: productError }] = await Promise.all([
    auth.client.from('faa_activities').select('id').eq('id', activityId).eq('org_id', orgId).maybeSingle(),
    auth.client.from('faa_products').select('id').eq('id', productId).eq('org_id', orgId).maybeSingle(),
  ]);
  if (activityError || productError) return apiResponse({ message: 'Could not verify the selected activity and product.' }, 500);
  if (!activity || !product) return apiResponse({ message: 'The selected activity or product is outside this organization.' }, 404);

  let csv: string;
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return apiResponse({ message: 'CSV must use UTF-8 text encoding.' }, 400);
  }

  let table: ReturnType<typeof parseCsv>;
  try {
    table = parseCsv(csv);
  } catch (error) {
    return apiResponse({ message: error instanceof Error ? error.message : 'CSV format is invalid.' }, 400);
  }
  if (table.rows.length > MAX_FARMER_IMPORT_ROWS) {
    return apiResponse({ message: `CSV exceeds the ${MAX_FARMER_IMPORT_ROWS} row limit.` }, 413);
  }

  const col = (name: string) => table.headers.indexOf(name);
  if (col('phone') < 0 || col('village') < 0) {
    return apiResponse({ message: 'CSV needs phone and village columns.' }, 400);
  }

  let rows: ImportRow[];
  const errors: Array<{ line: number; code: string }> = [];
  try {
    rows = table.rows.map((cells, index) => {
      const value = (name: string) => cells[col(name)]?.trim() ?? '';
      const line = index + 2;
      const phone = normalizeIndianPhone(value('phone'));
      const languageInput = value('preferred_language').toLowerCase();
      const languageValue = languageInput === 'hindi' ? 'hi' : languageInput === 'bhojpuri' ? 'bho' : languageInput || 'hi';
      const consentStatus = consentStatusSchema.safeParse(value('consent_status') || 'unknown');
      const language = languageSchema.safeParse(languageValue);
      const recordingConsent = recordingConsentSchema.safeParse(value('recording_consent_status') || 'not_applicable');
      const consentAt = parseDate(value('consent_at'));
      const recordingConsentAt = parseDate(value('recording_consent_at'));
      if (!phone) errors.push({ line, code: 'invalid_indian_mobile' });
      if (!language.success) errors.push({ line, code: 'invalid_language' });
      if (!consentStatus.success) errors.push({ line, code: 'invalid_consent_status' });
      if (!recordingConsent.success) errors.push({ line, code: 'invalid_recording_consent_status' });
      if (!value('village') || value('village').length > 120) errors.push({ line, code: 'invalid_village' });
      if (value('full_name').length > 120) errors.push({ line, code: 'invalid_name' });
      if (value('consent_method') && !consentMethods.has(value('consent_method'))) {
        errors.push({ line, code: 'invalid_consent_method' });
      }
      if (consentStatus.success && consentStatus.data === 'eligible') {
        if (!consentAt || !value('consent_method') || !value('consent_source') || !value('consent_purpose') || !value('consent_evidence_ref')) {
          errors.push({ line, code: 'eligible_consent_needs_method_source_purpose_timestamp_and_evidence' });
        }
      }
      if (recordingConsent.success && recordingConsent.data === 'granted' && (!recordingConsentAt || !value('recording_consent_evidence_ref'))) {
        errors.push({ line, code: 'recording_consent_needs_separate_evidence' });
      }
      if ([value('consent_method'), value('consent_source'), value('consent_purpose'), value('consent_evidence_ref'), value('recording_consent_evidence_ref')].some((part) => part.length > 500)) {
        errors.push({ line, code: 'consent_evidence_field_too_long' });
      }
      if (!phone || !language.success || !consentStatus.success || !recordingConsent.success) {
        return null;
      }
      return {
        line,
        fullName: value('full_name') || null,
        externalRef: value('external_ref') || null,
        phone,
        phoneHmac: hashPhone(phone),
        phoneEncrypted: encryptPhone(phone),
        language: language.data,
        village: value('village'),
        district: value('district') || null,
        state: value('state') || null,
        consentStatus: consentStatus.data,
        consentMethod: value('consent_method') || null,
        consentSource: value('consent_source') || null,
        consentPurpose: value('consent_purpose') || null,
        consentAt,
        consentEvidenceRef: value('consent_evidence_ref') || null,
        recordingConsentStatus: recordingConsent.data,
        recordingConsentAt,
        recordingConsentEvidenceRef: value('recording_consent_evidence_ref') || null,
      };
    }).filter((row): row is ImportRow => row !== null);
  } catch {
    return apiResponse({ message: 'Server-side phone protection is not configured.' }, 503);
  }

  const seenPhones = new Set<string>();
  for (const row of rows) {
    if (seenPhones.has(row.phoneHmac)) errors.push({ line: row.line, code: 'duplicate_phone_in_file' });
    seenPhones.add(row.phoneHmac);
  }
  if (errors.length) return apiResponse({ message: 'Fix the row errors and upload the file again.', errors: errors.slice(0, MAX_ERRORS), errorCount: errors.length }, 422);

  const farmersToInsert = rows.map((row) => ({
    org_id: orgId,
    external_ref: row.externalRef,
    full_name: row.fullName,
    phone_encrypted: row.phoneEncrypted,
    phone_hmac: row.phoneHmac,
    preferred_language: row.language,
    village: row.village,
    district: row.district,
    state: row.state,
    do_not_call: ['declined', 'withdrawn', 'suppressed'].includes(row.consentStatus),
    opted_out_at: ['declined', 'withdrawn', 'suppressed'].includes(row.consentStatus) ? new Date().toISOString() : null,
    opt_out_source: ['declined', 'withdrawn', 'suppressed'].includes(row.consentStatus) ? row.consentSource ?? 'farmer_import' : null,
  }));
  for (const batch of chunk(farmersToInsert, 200)) {
    const { error } = await auth.client.from('faa_farmers').upsert(batch, {
      onConflict: 'org_id,phone_hmac',
      ignoreDuplicates: true,
    });
    if (error) return apiResponse({ message: 'Could not save the farmer import. Re-uploading this file is safe; phone numbers are deduplicated.' }, 500);
  }

  const farmerByHmac = new Map<string, { id: string; do_not_call: boolean }>();
  for (const batch of chunk(rows.map((row) => row.phoneHmac), 200)) {
    const { data, error } = await auth.client.from('faa_farmers')
      .select('id, phone_hmac, do_not_call')
      .eq('org_id', orgId)
      .in('phone_hmac', batch);
    if (error) return apiResponse({ message: 'Could not verify imported farmer records. Re-uploading this file is safe.' }, 500);
    for (const farmer of data ?? []) farmerByHmac.set(farmer.phone_hmac, { id: farmer.id, do_not_call: farmer.do_not_call });
  }

  const farmerIds = rows.map((row) => farmerByHmac.get(row.phoneHmac)?.id).filter((id): id is string => Boolean(id));
  const { data: priorParticipants, error: priorError } = await auth.client.from('faa_activity_participants')
    .select('farmer_id, consent_status')
    .eq('org_id', orgId)
    .eq('activity_id', activityId)
    .eq('product_id', productId)
    .in('farmer_id', farmerIds);
  if (priorError) return apiResponse({ message: 'Could not inspect existing consent status. No calls were queued.' }, 500);

  const priorSuppressed = new Set((priorParticipants ?? [])
    .filter((item) => ['declined', 'withdrawn', 'suppressed'].includes(item.consent_status))
    .map((item) => item.farmer_id));
  const existingDoNotCall = new Set([...farmerByHmac.values()].filter((farmer) => farmer.do_not_call).map((farmer) => farmer.id));
  const farmerIdByHmac = new Map(rows.map((row) => [row.phoneHmac, farmerByHmac.get(row.phoneHmac)?.id]));
  const farmersToSuppress = new Set<string>([
    ...existingDoNotCall,
    ...rows.filter((row) => ['declined', 'withdrawn', 'suppressed'].includes(row.consentStatus)).map((row) => farmerIdByHmac.get(row.phoneHmac)).filter((id): id is string => Boolean(id)),
    ...priorSuppressed,
  ]);
  const newlySuppressed = [...farmersToSuppress].filter((id) => !existingDoNotCall.has(id));

  if (newlySuppressed.length) {
    const { error } = await auth.client.from('faa_farmers').update({
      do_not_call: true,
      opted_out_at: new Date().toISOString(),
      opt_out_source: 'farmer_import_or_prior_withdrawal',
    }).eq('org_id', orgId).in('id', newlySuppressed);
    if (error) return apiResponse({ message: 'Could not apply the opt-out/suppression records. Do not start a call batch until this import is resolved.' }, 500);
  }

  const participantById = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const farmer = farmerByHmac.get(row.phoneHmac);
    if (!farmer) continue;
    const isSuppressed = farmer.do_not_call || farmersToSuppress.has(farmer.id);
    participantById.set(farmer.id, {
      org_id: orgId,
      activity_id: activityId,
      farmer_id: farmer.id,
      product_id: productId,
      participation_status: 'reported',
      consent_status: isSuppressed ? 'suppressed' : row.consentStatus,
      consent_method: row.consentMethod,
      consent_source: row.consentSource,
      consent_purpose: row.consentPurpose,
      consent_at: row.consentAt,
      consent_evidence_ref: row.consentEvidenceRef,
      recording_consent_status: row.recordingConsentStatus,
      recording_consent_at: row.recordingConsentAt,
      recording_consent_evidence_ref: row.recordingConsentEvidenceRef,
    });
  }

  const participants = [...participantById.values()];
  for (const batch of chunk(participants, 200)) {
    const { error } = await auth.client.from('faa_activity_participants').upsert(batch, {
      onConflict: 'activity_id,farmer_id,product_id',
    });
    if (error) return apiResponse({ message: 'Farmer records were saved, but activity mapping did not finish. Re-uploading is safe; inspect the report before preparing calls.' }, 500);
  }

  const { error: auditError } = await auth.client.from('faa_audit_events').insert({
    org_id: orgId,
    actor_id: auth.userId,
    event_type: 'farmers.imported',
    entity_type: 'activity',
    entity_id: activityId,
    details: {
      rows: participants.length,
      eligible: participants.filter((item) => item.consent_status === 'eligible').length,
      unknown: participants.filter((item) => item.consent_status === 'unknown').length,
      suppressed: participants.filter((item) => item.consent_status === 'suppressed').length,
      product_id: productId,
    },
  });
  if (auditError) return apiResponse({ message: 'Farmer records were saved, but the import audit event could not be recorded. No calls were queued.' }, 500);

  return apiResponse({
    accepted: true,
    summary: {
      imported: participants.length,
      eligible: participants.filter((item) => item.consent_status === 'eligible').length,
      unknown: participants.filter((item) => item.consent_status === 'unknown').length,
      suppressed: participants.filter((item) => item.consent_status === 'suppressed').length,
    },
    message: 'Farmer data was imported. Import does not place calls.',
  }, 201);
}
