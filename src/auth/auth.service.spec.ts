import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Role } from '../generated/proto/auth.js';
import { envs } from '../config/envs.js';

const userId = '6abd26a42d059ac027376c78';
const ownerId = '6abd26a42d059ac027376c79';
const password = 'Str0ng!Pass';

const buildUserDocument = async (overrides: Record<string, unknown> = {}) => ({
  _id: userId,
  name: 'Ana',
  email: 'ana@syner.com',
  password: await bcrypt.hash(password, 4),
  role: Role.user,
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

  // db.orm.users.where(...).first() / .where(...).update(...) / db.orm.users.create(...)
  const first = vi.fn();
  const update = vi.fn();
  const users = { where: vi.fn(() => ({ first, update })), create: vi.fn() };
  const prisma = { db: { orm: { users } } };

  const newUser = { name: 'Ana', email: 'ana@syner.com', password };

  beforeEach(async () => {
    vi.clearAllMocks();
    users.create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: userId, ...data }));

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

  describe('seedOwner', () => {
    it('creates the owner from the env when it does not exist', async () => {
      first.mockResolvedValue(null);

      await service.seedOwner();

      expect(users.where).toHaveBeenCalledWith({ email: envs.owner.email });
      const stored = users.create.mock.calls[0][0];
      expect(stored).toMatchObject({ name: envs.owner.name, email: envs.owner.email, role: Role.owner });
      expect(await bcrypt.compare(envs.owner.password, stored.password)).toBe(true);
    });

    it('leaves an existing user with the owner email untouched', async () => {
      first.mockResolvedValue(await buildUserDocument({ email: envs.owner.email }));

      await service.seedOwner();

      expect(users.create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('registerUser', () => {
    it('stores a bcrypt hash and the user role, and returns the user without the password plus a token', async () => {
      first.mockResolvedValue(null);

      const result = await service.registerUser({ ...newUser, requester_role: Role.admin });

      const stored = users.create.mock.calls[0][0];
      expect(stored.password).not.toBe(password);
      expect(await bcrypt.compare(password, stored.password)).toBe(true);
      expect(stored.createdAt).toBeInstanceOf(Date);
      expect(stored.role).toBe(Role.user);
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', role: Role.user });
      expect(jwtService.verify(result.token)).toMatchObject(result.user!);
    });

    it.each([Role.owner, Role.admin, Role.user])('lets an owner register a %s', async (role) => {
      first.mockResolvedValue(null);

      const result = await service.registerUser({ ...newUser, role, requester_role: Role.owner });

      expect(result.user?.role).toBe(role);
    });

    it.each([
      [Role.admin, Role.admin],
      [Role.admin, Role.owner],
      [Role.user, Role.user],
    ])('rejects a %s registering a %s with PERMISSION_DENIED', async (requester_role, role) => {
      await expectRpcError(
        service.registerUser({ ...newUser, role, requester_role }),
        status.PERMISSION_DENIED,
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('rejects an email that is already registered with ALREADY_EXISTS', async () => {
      first.mockResolvedValue(await buildUserDocument());

      await expectRpcError(
        service.registerUser({ ...newUser, requester_role: Role.owner }),
        status.ALREADY_EXISTS,
      );
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('loginUser', () => {
    it('returns the user with its role and a token for valid credentials', async () => {
      first.mockResolvedValue(await buildUserDocument({ role: Role.admin }));

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(users.where).toHaveBeenCalledWith({ email: 'ana@syner.com' });
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', role: Role.admin });
      expect(result.token).toEqual(expect.any(String));
    });

    it('treats a user stored without a role as user', async () => {
      first.mockResolvedValue(await buildUserDocument({ role: undefined }));

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(result.user?.role).toBe(Role.user);
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
    it('reloads the user so the renewed token carries its current role', async () => {
      const token = jwtService.sign({ id: userId, name: 'Ana', email: 'ana@syner.com', role: Role.user });
      first.mockResolvedValue(await buildUserDocument({ role: Role.admin }));

      const result = await service.verify(token);

      expect(users.where).toHaveBeenCalledWith({ _id: userId });
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', role: Role.admin });
      expect(jwtService.verify(result.token)).toMatchObject(result.user!);
    });

    it('rejects a token whose user no longer exists with UNAUTHENTICATED', async () => {
      const token = jwtService.sign({ id: userId });
      first.mockResolvedValue(null);

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
    });

    it('rejects a token signed with another secret with UNAUTHENTICATED', async () => {
      const token = new JwtService({ secret: 'other-secret' }).sign({ id: userId });

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
      expect(first).not.toHaveBeenCalled();
    });
  });

  describe('updateUserRole', () => {
    const owner = () => buildUserDocument({ _id: ownerId, email: 'owner@syner.com', role: Role.owner });

    it('lets an owner change another user role', async () => {
      first.mockResolvedValueOnce(await owner()).mockResolvedValueOnce(await buildUserDocument());

      const result = await service.updateUserRole({ user_id: userId, role: Role.admin, requester_id: ownerId });

      expect(users.where).toHaveBeenLastCalledWith({ _id: userId });
      expect(update).toHaveBeenCalledWith({ role: Role.admin });
      expect(result).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', role: Role.admin });
    });

    it('rejects a requester that is not an owner with PERMISSION_DENIED', async () => {
      first.mockResolvedValueOnce(await buildUserDocument({ _id: ownerId, role: Role.admin }));

      await expectRpcError(
        service.updateUserRole({ user_id: userId, role: Role.admin, requester_id: ownerId }),
        status.PERMISSION_DENIED,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects an owner changing their own role with PERMISSION_DENIED', async () => {
      first.mockResolvedValueOnce(await owner());

      await expectRpcError(
        service.updateUserRole({ user_id: ownerId, role: Role.user, requester_id: ownerId }),
        status.PERMISSION_DENIED,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects an unknown user with NOT_FOUND', async () => {
      first.mockResolvedValueOnce(await owner()).mockResolvedValueOnce(null);

      await expectRpcError(
        service.updateUserRole({ user_id: userId, role: Role.admin, requester_id: ownerId }),
        status.NOT_FOUND,
      );
      expect(update).not.toHaveBeenCalled();
    });
  });
});
