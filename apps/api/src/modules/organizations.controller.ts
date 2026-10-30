import { Controller, Get, InternalServerErrorException, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../auth/supabase.service';

type AuthenticatedOrganizationRequest = Request & {
  faaAccessToken: string;
  faaUserId: string;
};

@UseGuards(SupabaseAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(@Req() request: AuthenticatedOrganizationRequest) {
    const client = this.supabase.createUserClient(request.faaAccessToken);
    const { data: memberships, error: membershipError } = await client
      .from('faa_organization_members')
      .select('org_id, role')
      .eq('user_id', request.faaUserId)
      .order('org_id')
      .limit(100);

    if (membershipError) {
      throw new InternalServerErrorException('Could not load organization memberships.');
    }
    if (!memberships?.length) return { data: [] };

    const { data: organizations, error: organizationError } = await client
      .from('faa_organizations')
      .select('id, name')
      .in('id', memberships.map((membership) => membership.org_id))
      .order('name')
      .limit(100);

    if (organizationError) {
      throw new InternalServerErrorException('Could not load organizations.');
    }

    const roleByOrganization = new Map(memberships.map(({ org_id, role }) => [org_id, role]));
    return {
      data: (organizations ?? []).map((organization) => ({
        ...organization,
        role: roleByOrganization.get(organization.id) ?? 'viewer',
      })),
    };
  }
}

