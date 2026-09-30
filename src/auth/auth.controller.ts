import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service.js';
import { LoginUserDto, RegisterUserDto, VerifyTokenDto } from './dto/index.js';
import { AUTH_SERVICE_NAME } from '../generated/proto/auth.js';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @GrpcMethod(AUTH_SERVICE_NAME, 'RegisterUser')
  registerUser(@Payload() registerUserDto: RegisterUserDto) {
    return this.authService.registerUser(registerUserDto);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'LoginUser')
  loginUser(@Payload() loginUserDto: LoginUserDto) {
    return this.authService.loginUser(loginUserDto);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'Verify')
  verify(@Payload() { token }: VerifyTokenDto) {
    return this.authService.verify(token);
  }
}
