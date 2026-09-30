import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const userId = '6abd26a42d059ac027376c78';
const password = 'Str0ng!Pass';

const buildUserDocument = async (overrides: Record<string, unknown> = {}) => ({
  _id: userId,
  name: 'Ana',
  email: 'ana@syner.com',
  password: await bcrypt.hash(password, 4),
  createdAt: new Date('2026-09-30T12:00:00.000Z'),
  ...overrides,
});

const expectRpcError = async (promise: Promise<unknown>, code: status) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcException);
  expect((error as RpcException).getError()).toMatchObject({ code });
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  // db.orm.users.where(...).first() / db.orm.users.create(...)
  const first = vi.fn();
  const users = { where: vi.fn(() => ({ first })), create: vi.fn() };
  const prisma = { db: { orm: { users } } };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } }) },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  describe('registerUser', () => {
    it('stores a bcrypt hash and returns the user without the password plus a token', async () => {
      first.mockResolvedValue(null);
      users.create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: userId, ...data }));

      const result = await service.registerUser({ name: 'Ana', email: 'ana@syner.com', password });

      const stored = users.create.mock.calls[0][0];
      expect(stored.password).not.toBe(password);
      expect(await bcrypt.compare(password, stored.password)).toBe(true);
      expect(stored.createdAt).toBeInstanceOf(Date);
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com' });
      expect(jwtService.verify(result.token)).toMatchObject(result.user!);
    });

    it('rejects an email that is already registered with ALREADY_EXISTS', async () => {
      first.mockResolvedValue(await buildUserDocument());

      await expectRpcError(
        service.registerUser({ name: 'Ana', email: 'ana@syner.com', password }),
        status.ALREADY_EXISTS,
      );
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('loginUser', () => {
    it('returns the user and a token for valid credentials', async () => {
      first.mockResolvedValue(await buildUserDocument());

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(users.where).toHaveBeenCalledWith({ email: 'ana@syner.com' });
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com' });
      expect(result.token).toEqual(expect.any(String));
    });

    it('rejects a wrong password with UNAUTHENTICATED', async () => {
      first.mockResolvedValue(await buildUserDocument());

      await expectRpcError(
        service.loginUser({ email: 'ana@syner.com', password: 'wrong' }),
        status.UNAUTHENTICATED,
      );
    });

    it('rejects an unknown email with UNAUTHENTICATED', async () => {
      first.mockResolvedValue(null);

      await expectRpcError(
        service.loginUser({ email: 'nobody@syner.com', password }),
        status.UNAUTHENTICATED,
      );
    });
  });

  describe('verify', () => {
    it('returns the token user with a freshly signed token', async () => {
      const user = { id: userId, name: 'Ana', email: 'ana@syner.com' };
      const token = jwtService.sign(user);

      const result = await service.verify(token);

      expect(result.user).toEqual(user);
      expect(jwtService.verify(result.token)).toMatchObject(user);
    });

    it('rejects a token signed with another secret with UNAUTHENTICATED', async () => {
      const token = new JwtService({ secret: 'other-secret' }).sign({ id: userId });

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
    });
  });
});
