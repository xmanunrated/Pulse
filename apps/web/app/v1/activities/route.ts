import { z } from 'zod';
import { apiResponse, authenticateRequest } from '../../../lib/faa-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const uuidSchema = z.string().uuid();
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  });

const createActivitySchema = z.object({
  orgId: uuidSchema,
  staffRef: z.string().trim().min(1).max(120),
  village: z.string().trim().min(1).max(120),
  activityDate: dateSchema,
  productSku: z.string().trim().min(1).max(80),
  reportedFarmerCount: z.number().int().min(1).max(100000),
  externalRef: z.string().trim().max(100).optional(),
}).strict();

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const orgId = new URL(request.url).searchParams.get('orgId');
  if (orgId && !uuidSchema.safeParse(orgId).success) {
    return apiResponse({ message: 'orgId must be a UUID.' }, 400);
  }

  let query = auth.client
    .from('faa_activities')
    .select('id, org_id, external_ref, staff_ref, village, district, state, activity_date, activity_type, status, metadata, created_at, updated_at')
    .order('activity_date', { ascending: false })
    .limit(500);
  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;
  if (error) return apiResponse({ message: 'Could not load activities.' }, 500);
  return apiResponse({ data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ message: 'Request body must be valid JSON.' }, 400);
  }

  const parsed = createActivitySchema.safeParse(body);
  if (!parsed.success) return apiResponse({ message: 'Activity details are invalid.' }, 400);
  const activity = parsed.data;

  const { data: membership, error: membershipError } = await auth.client
    .from('faa_organization_members')
    .select('role')
    .eq('org_id', activity.orgId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (membershipError) {
    return apiResponse({ message: 'Could not verify organization membership.' }, 500);
  }
  if (!membership || !['owner', 'admin', 'auditor'].includes(membership.role)) {
    return apiResponse({ message: 'You do not have permission to add activities to this organization.' }, 403);
  }

  const { data, error } = await auth.client
    .from('faa_activities')
    .insert({
      org_id: activity.orgId,
      created_by: auth.userId,
      staff_ref: activity.staffRef,
      village: activity.village,
      activity_date: activity.activityDate,
      external_ref: activity.externalRef ?? null,
      metadata: {
        product_sku: activity.productSku,
        reported_farmer_count: activity.reportedFarmerCount,
      },
    })
    .select('id, org_id, external_ref, staff_ref, village, activity_date, status, metadata, created_at')
    .single();

  if (error) return apiResponse({ message: 'Could not save activity.' }, 500);
  return apiResponse({ accepted: true, data }, 201);
}

