import { IsBoolean, IsJWT, IsOptional } from 'class-validator';

export class VerifyTokenDto {
  @IsJWT()
  public token: string;

  @IsOptional()
  @IsBoolean()
  public include_memberships?: boolean;
}
