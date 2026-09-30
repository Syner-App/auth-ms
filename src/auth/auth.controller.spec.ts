import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { Role } from '../generated/proto/auth.js';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    loginUser: vi.fn(),
    switchOrganization: vi.fn(),
    verify: vi.fn(),
    updateUserRole: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('delegates LoginUser to the service', async () => {
    const dto = { email: 'ana@syner.com', password: 'Str0ng!Pass' };
    await controller.loginUser(dto);
    expect(authService.loginUser).toHaveBeenCalledWith(dto);
  });

  it('delegates SwitchOrganization to the service', async () => {
    const dto = { requester_id: '6abd26a42d059ac027376c78', organization_id: '6abd26a42d059ac027376ca1' };
    await controller.switchOrganization(dto);
    expect(authService.switchOrganization).toHaveBeenCalledWith(dto);
  });

  it('delegates Verify to the service with the token', async () => {
    await controller.verify({ token: 'a.b.c' });
    expect(authService.verify).toHaveBeenCalledWith('a.b.c');
  });

  it('delegates UpdateUserRole to the service', async () => {
    const dto = {
      user_id: '6abd26a42d059ac027376c78',
      role: Role.admin,
      requester_id: '6abd26a42d059ac027376c79',
      organization_id: '6abd26a42d059ac027376ca1',
    };
    await controller.updateUserRole(dto);
    expect(authService.updateUserRole).toHaveBeenCalledWith(dto);
  });
});
