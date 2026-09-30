import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service.js';
import { LoginUserDto, SwitchOrganizationDto, UpdateUserRoleDto, VerifyTokenDto } from './dto/index.js';
import { AUTH_SERVICE_NAME } from '../generated/proto/auth.js';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @GrpcMethod(AUTH_SERVICE_NAME, 'LoginUser')
  loginUser(@Payload() loginUserDto: LoginUserDto) {
    return this.authService.loginUser(loginUserDto);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'SwitchOrganization')
  switchOrganization(@Payload() switchOrganizationDto: SwitchOrganizationDto) {
    return this.authService.switchOrganization(switchOrganizationDto);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'Verify')
  verify(@Payload() { token }: VerifyTokenDto) {
    return this.authService.verify(token);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'UpdateUserRole')
  updateUserRole(@Payload() updateUserRoleDto: UpdateUserRoleDto) {
    return this.authService.updateUserRole(updateUserRoleDto);
  }
}
