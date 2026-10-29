import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

class CreateActivityDto {
  @IsString() @IsNotEmpty() orgId!: string;
  @IsString() @IsNotEmpty() staffRef!: string;
  @IsString() @IsNotEmpty() village!: string;
  @IsDateString() activityDate!: string;
  @IsString() @IsNotEmpty() productSku!: string;
  @IsInt() @Min(1) reportedFarmerCount!: number;
  @IsOptional() @IsString() externalRef?: string;
}

@Controller('activities')
export class ActivitiesController {
  @Get() list() {
    return { mode: 'not-connected', data: [], message: 'Connect authenticated Supabase tenant context before exposing production records.' };
  }
  @Post() create(@Body() dto: CreateActivityDto) {
    return { accepted: false, mode: 'scaffold-only', receivedFields: Object.keys(dto), message: 'Persistence is intentionally disabled until JWT verification and organization membership checks are wired.' };
  }
}
