import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrganizationStatus, PlatformRole, Role } from '../generated/proto/auth.js';
import { envs } from '../config/envs.js';

const userId = '6abd26a42d059ac027376c78';
const ownerId = '6abd26a42d059ac027376c79';
const orgA = '6abd26a42d059ac027376ca1';
const orgB = '6abd26a42d059ac027376cb2';
const password = 'Str0ng!Pass';

const buildUserDocument = async (overrides: Record<string, unknown> = {}) => ({
  _id: userId,
  name: 'Ana',
  email: 'ana@syner.com',
  password: await bcrypt.hash(password, 4),
  platform_role: null,
  createdAt: new Date('2026-09-30T12:00:00.000Z'),
  ...overrides,
});

const organization = (_id: string, overrides: Record<string, unknown> = {}) => ({
  _id,
  name: `Org ${_id.slice(-2)}`,
  slug: `org-${_id.slice(-2)}`,
  status: OrganizationStatus.ACTIVE,
  createdAt: new Date('2026-09-30T12:00:00.000Z'),
  ...overrides,
});

const membership = (organization_id: string, role: Role, user_id = userId) => ({
  _id: `${organization_id.slice(0, 22)}ff`,
  user_id,
  organization_id,
  role,
  createdAt: new Date('2026-09-30T12:00:00.000Z'),
});

const expectRpcError = async (promise: Promise<unknown>, code: status) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcException);
  expect((error as RpcException).getError()).toMatchObject({ code });
};

// db.orm.<collection>.where(...).first() / .update() / .all(), db.orm.<collection>.create(...)
const mockCollection = () => {
  const query = { first: vi.fn(), update: vi.fn(), all: vi.fn() };
  return { ...query, where: vi.fn((_filter: Record<string, unknown>) => query), create: vi.fn() };
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  const users = mockCollection();
  const memberships = mockCollection();
  const organizations = mockCollection();
  const prisma = { db: { orm: { users, memberships, organizations } } };

  // Organizations looked up by id
  const withOrganizations = (...docs: ReturnType<typeof organization>[]) =>
    organizations.where.mockImplementation(({ _id }) => ({
      ...organizations,
      first: vi.fn().mockResolvedValue(docs.find((doc) => doc._id === _id) ?? null),
    }));

  beforeEach(async () => {
    vi.clearAllMocks();
    organizations.where.mockImplementation(() => organizations);
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

  describe('seedSuperadmin', () => {
    it('creates the superadmin from the env when it does not exist', async () => {
      users.first.mockResolvedValue(null);

      await service.seedSuperadmin();

      expect(users.where).toHaveBeenCalledWith({ email: envs.superadmin.email });
      const stored = users.create.mock.calls[0][0];
      expect(stored).toMatchObject({
        name: envs.superadmin.name,
        email: envs.superadmin.email,
        platform_role: PlatformRole.superadmin,
      });
      expect(await bcrypt.compare(envs.superadmin.password, stored.password)).toBe(true);
    });

    it('leaves an existing user with the superadmin email untouched', async () => {
      users.first.mockResolvedValue(await buildUserDocument({ email: envs.superadmin.email }));

      await service.seedSuperadmin();

      expect(users.create).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('loginUser', () => {
    it('scopes the token to the only active organization of the user', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([membership(orgA, Role.admin)]);
      withOrganizations(organization(orgA));

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', organization_id: orgA, role: Role.admin });
      expect(result.memberships).toEqual([
        { organization_id: orgA, organization_name: 'Org a1', organization_slug: 'org-a1', role: Role.admin },
      ]);
      expect(jwtService.verify(result.token)).toMatchObject({ id: userId, organization_id: orgA });
    });

    it('returns a token without organization and the memberships when the user has several', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([membership(orgA, Role.user), membership(orgB, Role.owner)]);
      withOrganizations(organization(orgA), organization(orgB));

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com' });
      expect(result.memberships.map(({ organization_id }) => organization_id)).toEqual([orgA, orgB]);
      expect(jwtService.verify(result.token).organization_id).toBeUndefined();
    });

    it('scopes the token to the requested organization', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([membership(orgA, Role.user), membership(orgB, Role.owner)]);
      withOrganizations(organization(orgA), organization(orgB));

      const result = await service.loginUser({ email: 'ana@syner.com', password, organization_id: orgB });

      expect(result.user).toMatchObject({ organization_id: orgB, role: Role.owner });
    });

    it('ignores memberships of suspended organizations', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([membership(orgA, Role.user), membership(orgB, Role.owner)]);
      withOrganizations(organization(orgA, { status: OrganizationStatus.SUSPENDED }), organization(orgB));

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(result.user).toMatchObject({ organization_id: orgB, role: Role.owner });
      expect(result.memberships).toHaveLength(1);
    });

    it('rejects a requested organization the user does not belong to with PERMISSION_DENIED', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([membership(orgA, Role.user)]);
      withOrganizations(organization(orgA));

      await expectRpcError(
        service.loginUser({ email: 'ana@syner.com', password, organization_id: orgB }),
        status.PERMISSION_DENIED,
      );
    });

    it('rejects a user without active organizations with PERMISSION_DENIED', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.all.mockResolvedValue([]);

      await expectRpcError(service.loginUser({ email: 'ana@syner.com', password }), status.PERMISSION_DENIED);
    });

    it('lets the superadmin in without an organization', async () => {
      users.first.mockResolvedValue(await buildUserDocument({ platform_role: PlatformRole.superadmin }));
      memberships.all.mockResolvedValue([]);

      const result = await service.loginUser({ email: 'ana@syner.com', password });

      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', platform_role: PlatformRole.superadmin });
    });

    it('rejects a wrong password with UNAUTHENTICATED', async () => {
      users.first.mockResolvedValue(await buildUserDocument());

      await expectRpcError(
        service.loginUser({ email: 'ana@syner.com', password: 'wrong' }),
        status.UNAUTHENTICATED,
      );
    });

    it('rejects an unknown email with UNAUTHENTICATED', async () => {
      users.first.mockResolvedValue(null);

      await expectRpcError(
        service.loginUser({ email: 'nobody@syner.com', password }),
        status.UNAUTHENTICATED,
      );
    });
  });

  describe('switchOrganization', () => {
    it('returns a token scoped to another organization of the caller', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.first.mockResolvedValue(membership(orgB, Role.admin));
      withOrganizations(organization(orgB));

      const result = await service.switchOrganization({ requester_id: userId, organization_id: orgB });

      expect(memberships.where).toHaveBeenCalledWith({ user_id: userId, organization_id: orgB });
      expect(result.user).toMatchObject({ organization_id: orgB, role: Role.admin });
      expect(jwtService.verify(result.token)).toMatchObject({ id: userId, organization_id: orgB });
    });

    it('rejects an organization the caller does not belong to with PERMISSION_DENIED', async () => {
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.first.mockResolvedValue(null);

      await expectRpcError(
        service.switchOrganization({ requester_id: userId, organization_id: orgB }),
        status.PERMISSION_DENIED,
      );
    });
  });

  describe('verify', () => {
    it('reloads the membership so the renewed token carries the current role', async () => {
      const token = jwtService.sign({ id: userId, organization_id: orgA });
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.first.mockResolvedValue(membership(orgA, Role.admin));
      withOrganizations(organization(orgA));

      const result = await service.verify(token);

      expect(users.where).toHaveBeenCalledWith({ _id: userId });
      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', organization_id: orgA, role: Role.admin });
      expect(jwtService.verify(result.token)).toMatchObject({ id: userId, organization_id: orgA });
    });

    it('verifies a token without organization without loading memberships', async () => {
      const token = jwtService.sign({ id: userId });
      users.first.mockResolvedValue(await buildUserDocument({ platform_role: PlatformRole.superadmin }));

      const result = await service.verify(token);

      expect(result.user).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', platform_role: PlatformRole.superadmin });
      expect(memberships.where).not.toHaveBeenCalled();
    });

    it('rejects a token whose membership was removed with UNAUTHENTICATED', async () => {
      const token = jwtService.sign({ id: userId, organization_id: orgA });
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.first.mockResolvedValue(null);

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
    });

    it('rejects a token of a suspended organization with PERMISSION_DENIED', async () => {
      const token = jwtService.sign({ id: userId, organization_id: orgA });
      users.first.mockResolvedValue(await buildUserDocument());
      memberships.first.mockResolvedValue(membership(orgA, Role.owner));
      withOrganizations(organization(orgA, { status: OrganizationStatus.SUSPENDED }));

      await expectRpcError(service.verify(token), status.PERMISSION_DENIED);
    });

    it('rejects a token whose user no longer exists with UNAUTHENTICATED', async () => {
      const token = jwtService.sign({ id: userId });
      users.first.mockResolvedValue(null);

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
    });

    it('rejects a token signed with another secret with UNAUTHENTICATED', async () => {
      const token = new JwtService({ secret: 'other-secret' }).sign({ id: userId });

      await expectRpcError(service.verify(token), status.UNAUTHENTICATED);
      expect(users.first).not.toHaveBeenCalled();
    });
  });

  describe('updateUserRole', () => {
    const request = { user_id: userId, role: Role.admin, requester_id: ownerId, organization_id: orgA };

    it('lets an owner change the role of another member of the organization', async () => {
      memberships.first
        .mockResolvedValueOnce(membership(orgA, Role.owner, ownerId))
        .mockResolvedValueOnce(membership(orgA, Role.user));
      users.first.mockResolvedValue(await buildUserDocument());

      const result = await service.updateUserRole(request);

      expect(memberships.where).toHaveBeenNthCalledWith(1, { user_id: ownerId, organization_id: orgA });
      expect(memberships.where).toHaveBeenNthCalledWith(2, { user_id: userId, organization_id: orgA });
      expect(memberships.update).toHaveBeenCalledWith({ role: Role.admin });
      expect(result).toEqual({ id: userId, name: 'Ana', email: 'ana@syner.com', organization_id: orgA, role: Role.admin });
    });

    it('rejects a requester that is not an owner of the organization with PERMISSION_DENIED', async () => {
      memberships.first.mockResolvedValueOnce(membership(orgA, Role.admin, ownerId));

      await expectRpcError(service.updateUserRole(request), status.PERMISSION_DENIED);
      expect(memberships.update).not.toHaveBeenCalled();
    });

    it('rejects a requester that does not belong to the organization with PERMISSION_DENIED', async () => {
      memberships.first.mockResolvedValueOnce(null);

      await expectRpcError(service.updateUserRole(request), status.PERMISSION_DENIED);
      expect(memberships.update).not.toHaveBeenCalled();
    });

    it('rejects an owner changing their own role with PERMISSION_DENIED', async () => {
      memberships.first.mockResolvedValueOnce(membership(orgA, Role.owner, ownerId));

      await expectRpcError(
        service.updateUserRole({ ...request, user_id: ownerId, role: Role.user }),
        status.PERMISSION_DENIED,
      );
      expect(memberships.update).not.toHaveBeenCalled();
    });

    it('rejects a user that is not a member of the organization with NOT_FOUND', async () => {
      memberships.first.mockResolvedValueOnce(membership(orgA, Role.owner, ownerId)).mockResolvedValueOnce(null);

      await expectRpcError(service.updateUserRole(request), status.NOT_FOUND);
      expect(memberships.update).not.toHaveBeenCalled();
    });
  });
});
