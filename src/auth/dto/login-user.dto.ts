import { IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginUserDto {
  @IsEmail()
  public email: string;

  @IsString()
  @IsNotEmpty()
  public password: string;

  // Organization to scope the token to (required when the user belongs to several)
  @IsOptional()
  @IsMongoId()
  public organization_id?: string;
}
