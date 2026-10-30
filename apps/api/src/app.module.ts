import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './auth/supabase-auth.guard';
import { SupabaseService } from './auth/supabase.service';
import { HealthController } from './health.controller';
import { ActivitiesController } from './modules/activities.controller';

@Module({
  controllers: [HealthController, ActivitiesController],
  providers: [SupabaseAuthGuard, SupabaseService],
})
export class AppModule {}

