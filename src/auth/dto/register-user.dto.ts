import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsStrongPassword } from 'class-validator';
import type { Role } from '../../generated/proto/auth.js';
import { ROLES } from '../roles.js';

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  public name: string;

  @IsEmail()
  public email: string;

  // Min 8 chars with at least one lowercase, uppercase, number and symbol
  @IsString()
  @IsStrongPassword()
  public password: string;

  // Defaults to user
  @IsOptional()
  @IsIn(ROLES)
  public role?: Role;

  // Role of the authenticated caller, set by client-gateway
  @IsIn(ROLES)
  public requester_role: Role;
}
