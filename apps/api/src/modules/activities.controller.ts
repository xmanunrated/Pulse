import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, isUUID } from 'class-validator';
import type { Request } from 'express';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../auth/supabase.service';

type AuthenticatedActivityRequest = Request & {
  faaAccessToken: string;
  faaUserId: string;
};

class CreateActivityDto {
  @IsUUID() orgId!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) staffRef!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) village!: string;
  @IsDateString() activityDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) productSku!: string;
  @IsInt() @Min(1) @Max(100000) reportedFarmerCount!: number;
  @IsOptional() @IsString() @MaxLength(100) externalRef?: string;
}

@UseGuards(SupabaseAuthGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(
    @Req() request: AuthenticatedActivityRequest,
    @Query('orgId') orgId?: string,
  ) {
    if (orgId && !isUUID(orgId)) throw new BadRequestException('orgId must be a UUID.');

    const client = this.supabase.createUserClient(request.faaAccessToken);
    let query = client
      .from('faa_activities')
      .select('id, org_id, external_ref, staff_ref, village, district, state, activity_date, activity_type, status, metadata, created_at, updated_at')
      .order('activity_date', { ascending: false })
      .limit(500);
    if (orgId) query = query.eq('org_id', orgId);

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Could not load activities.');
    return { data: data ?? [] };
  }

  @Post()
  async create(
    @Req() request: AuthenticatedActivityRequest,
    @Body() dto: CreateActivityDto,
  ) {
    const client = this.supabase.createUserClient(request.faaAccessToken);
    const { data: membership, error: membershipError } = await client
      .from('faa_organization_members')
      .select('role')
      .eq('org_id', dto.orgId)
      .eq('user_id', request.faaUserId)
      .maybeSingle();

    if (membershipError) {
      throw new InternalServerErrorException('Could not verify organization membership.');
    }
    if (!membership || !['owner', 'admin', 'auditor'].includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to add activities to this organization.');
    }

    const { data, error } = await client
      .from('faa_activities')
      .insert({
        org_id: dto.orgId,
        created_by: request.faaUserId,
        staff_ref: dto.staffRef,
        village: dto.village,
        activity_date: dto.activityDate,
        external_ref: dto.externalRef ?? null,
        metadata: {
          product_sku: dto.productSku,
          reported_farmer_count: dto.reportedFarmerCount,
        },
      })
      .select('id, org_id, external_ref, staff_ref, village, activity_date, status, metadata, created_at')
      .single();

    if (error) throw new InternalServerErrorException('Could not save activity.');
    return { accepted: true, data };
  }
}

