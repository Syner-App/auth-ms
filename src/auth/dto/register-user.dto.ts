import { IsEmail, IsNotEmpty, IsString, IsStrongPassword } from 'class-validator';

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
}
