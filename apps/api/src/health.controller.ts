import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get() getHealth() { return { ok: true, service: 'farmer-activity-audit-api', mode: process.env.NODE_ENV ?? 'development' }; }
}
