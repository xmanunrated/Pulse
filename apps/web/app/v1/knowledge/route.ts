import { z } from 'zod';
import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const claimSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  sourceUrl: z.string().url().refine((value) => value.startsWith('https://')),
  sourceLabel: z.string().trim().max(160).optional(),
}).strict();

const createKnowledgeSchema = z.object({
  orgId: z.string().uuid(),
  productId: z.string().uuid(),
  language: z.enum(['hi', 'bho', 'en']),
  claims: z.array(claimSchema).min(1).max(25),
}).strict();

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const search = new URL(request.url).searchParams;
  const orgId = search.get('orgId');
  if (!validUuid(orgId)) return apiResponse({ message: 'orgId must be a UUID.' }, 400);

  let query = auth.client.from('faa_product_knowledge_versions')
    .select('id, org_id, product_id, version, language, content_json, source_refs, status, approved_by, approved_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200);
  const productId = search.get('productId');
  if (productId) {
    if (!validUuid(productId)) return apiResponse({ message: 'productId must be a UUID.' }, 400);
    query = query.eq('product_id', productId);
  }
  const { data, error } = await query;
  if (error) return apiResponse({ message: 'Could not load product knowledge.' }, 500);
  return apiResponse({ data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  const parsed = createKnowledgeSchema.safeParse(body);
  if (!parsed.success) return apiResponse({ message: 'Add at least one claim with an HTTPS source URL.' }, 400);
  const input = parsed.data;
  const membership = await requireOrganizationRole(auth, input.orgId, ['owner', 'admin', 'auditor']);
  if (!membership.ok) return membership.response;

  const { data: product, error: productError } = await auth.client.from('faa_products')
    .select('id')
    .eq('id', input.productId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (productError) return apiResponse({ message: 'Could not verify the selected product.' }, 500);
  if (!product) return apiResponse({ message: 'The selected product is outside this organization.' }, 404);

  const { data: latest, error: latestError } = await auth.client.from('faa_product_knowledge_versions')
    .select('version')
    .eq('product_id', input.productId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return apiResponse({ message: 'Could not allocate a knowledge version.' }, 500);
  const version = (latest?.version ?? 0) + 1;
  const sourceRefs = [...new Map(input.claims.map((claim) => [claim.sourceUrl, {
    url: claim.sourceUrl,
    label: claim.sourceLabel || null,
  }])).values()];

  const { data, error } = await auth.client.from('faa_product_knowledge_versions').insert({
    org_id: input.orgId,
    product_id: input.productId,
    version,
    language: input.language,
    content_json: { claims: input.claims.map((claim, index) => ({ id: `claim-${index + 1}`, text: claim.text, sourceUrl: claim.sourceUrl })) },
    source_refs: sourceRefs,
    status: 'draft',
    created_by: auth.userId,
  }).select('id, product_id, version, language, content_json, source_refs, status, created_at').single();
  if (error) return apiResponse({ message: 'Could not save the knowledge draft. Retry to create the next version.' }, 409);

  const { error: auditError } = await auth.client.from('faa_audit_events').insert({
    org_id: input.orgId,
    actor_id: auth.userId,
    event_type: 'knowledge.draft_created',
    entity_type: 'knowledge_version',
    entity_id: data.id,
    details: { product_id: input.productId, version, claim_count: input.claims.length },
  });
  if (auditError) return apiResponse({ message: 'Knowledge draft was saved, but its audit event could not be recorded. Review the version before proceeding.' }, 500);
  return apiResponse({ data, message: 'Knowledge saved as a draft. It cannot be used for calls until a reviewer approves it.' }, 201);
}
