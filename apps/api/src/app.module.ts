import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ActivitiesController } from './modules/activities.controller';

@Module({ controllers: [HealthController, ActivitiesController] })
export class AppModule {}
