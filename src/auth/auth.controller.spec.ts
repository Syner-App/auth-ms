import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    registerUser: vi.fn(),
    loginUser: vi.fn(),
    verify: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('delegates RegisterUser to the service', async () => {
    const dto = { name: 'Ana', email: 'ana@syner.com', password: 'Str0ng!Pass' };
    await controller.registerUser(dto);
    expect(authService.registerUser).toHaveBeenCalledWith(dto);
  });

  it('delegates LoginUser to the service', async () => {
    const dto = { email: 'ana@syner.com', password: 'Str0ng!Pass' };
    await controller.loginUser(dto);
    expect(authService.loginUser).toHaveBeenCalledWith(dto);
  });

  it('delegates Verify to the service with the token', async () => {
    await controller.verify({ token: 'a.b.c' });
    expect(authService.verify).toHaveBeenCalledWith('a.b.c');
  });
});
