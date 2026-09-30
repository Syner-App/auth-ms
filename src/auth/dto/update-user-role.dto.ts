import { IsIn, IsMongoId } from 'class-validator';
import type { Role } from '../../generated/proto/auth.js';
import { ROLES } from '../roles.js';

export class UpdateUserRoleDto {
  @IsMongoId()
  public user_id: string;

  @IsIn(ROLES)
  public role: Role;

  // Id of the authenticated caller, set by client-gateway
  @IsMongoId()
  public requester_id: string;
}
