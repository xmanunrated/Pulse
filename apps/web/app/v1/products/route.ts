import { z } from 'zod';
import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';
import { requireOrganizationRole, validUuid } from '../../../lib/faa-authorization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const createProductSchema = z.object({
  orgId: z.string().uuid(),
  sku: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(120).optional(),
}).strict();

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const orgId = new URL(request.url).searchParams.get('orgId');
  if (!validUuid(orgId)) return apiResponse({ message: 'orgId must be a UUID.' }, 400);

  const { data, error } = await auth.client.from('faa_products')
    .select('id, sku, name, category, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
    .limit(200);
  if (error) return apiResponse({ message: 'Could not load products.' }, 500);
  return apiResponse({ data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return apiResponse({ message: 'Request body must be valid JSON.' }, 400); }
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) return apiResponse({ message: 'Product details are invalid.' }, 400);
  const input = parsed.data;
  const membership = await requireOrganizationRole(auth, input.orgId, ['owner', 'admin', 'auditor']);
  if (!membership.ok) return membership.response;

  const { data, error } = await auth.client.from('faa_products').insert({
    org_id: input.orgId,
    sku: input.sku.toUpperCase(),
    name: input.name,
    category: input.category || null,
  }).select('id, sku, name, category, active').single();
  if (error) return apiResponse({ message: 'Could not create the product. The SKU may already exist.' }, 409);
  const { error: auditError } = await auth.client.from('faa_audit_events').insert({
    org_id: input.orgId,
    actor_id: auth.userId,
    event_type: 'product.created',
    entity_type: 'product',
    entity_id: data.id,
    details: { sku: data.sku },
  });
  if (auditError) return apiResponse({ message: 'Product was created, but its audit event could not be recorded. Review the product before retrying.' }, 500);
  return apiResponse({ data }, 201);
}
