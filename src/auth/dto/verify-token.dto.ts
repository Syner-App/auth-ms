import { IsJWT } from 'class-validator';

export class VerifyTokenDto {
  @IsJWT()
  public token: string;
}
