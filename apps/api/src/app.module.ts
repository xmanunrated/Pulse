import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './auth/supabase-auth.guard';
import { SupabaseService } from './auth/supabase.service';
import { HealthController } from './health.controller';
import { ActivitiesController } from './modules/activities.controller';
import { OrganizationsController } from './modules/organizations.controller';

@Module({
  controllers: [HealthController, ActivitiesController, OrganizationsController],
  providers: [SupabaseAuthGuard, SupabaseService],
})
export class AppModule {}

