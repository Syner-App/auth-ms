import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, IsStrongPassword } from 'class-validator';
import type { Role } from '../../generated/proto/auth.js';
import { ROLES } from '../../auth/roles.js';
import { RequesterDto } from './requester.dto.js';

export class AddMemberDto extends RequesterDto {
  @IsMongoId()
  public organization_id: string;

  @IsEmail()
  public email: string;

  @IsIn(ROLES)
  public role: Role;

  // Only used (and then required) when no user has this email yet
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public name?: string;

  // Min 8 chars with at least one lowercase, uppercase, number and symbol
  @IsOptional()
  @IsString()
  @IsStrongPassword()
  public password?: string;
}
