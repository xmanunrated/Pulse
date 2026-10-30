import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';

export type AuthenticatedRequest = Request & {
  faaAccessToken: string;
  faaUserId: string;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string'
      ? /^Bearer\s+([^\s]+)$/i.exec(authorization)
      : null;

    if (!match) throw new UnauthorizedException('A Supabase access token is required.');

    const accessToken = match[1];
    const client = this.supabase.createUserClient(accessToken);
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException('The Supabase access token is invalid or expired.');
    }

    Object.assign(request, { faaAccessToken: accessToken, faaUserId: data.user.id });
    return true;
  }
}

