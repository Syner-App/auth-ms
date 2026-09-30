import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { OrganizationsService } from './organizations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrganizationStatus, PlatformRole, Role } from '../generated/proto/auth.js';

const superadminId = '6abd26a42d059ac027376c00';
const userId = '6abd26a42d059ac027376c78';
const orgId = '6abd26a42d059ac027376ca1';
const createdAt = new Date('2026-09-30T12:00:00.000Z');

const superadmin = { _id: superadminId, name: 'Root', email: 'root@syner.com', platform_role: PlatformRole.superadmin };
const ana = { _id: userId, name: 'Ana', email: 'ana@syner.com', platform_role: null };
const organization = { _id: orgId, name: 'Acme', slug: 'acme', status: OrganizationStatus.ACTIVE, createdAt };
const membership = { _id: '6abd26a42d059ac027376cff', user_id: userId, organization_id: orgId, role: Role.admin, createdAt };

const expectRpcError = async (promise: Promise<unknown>, code: status) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcException);
  expect((error as RpcException).getError()).toMatchObject({ code });
};

// db.orm.<collection>.where(...).first() / .update() / .delete() / .all(), .orderBy(...).all(), .create(...)
const mockCollection = () => {
  const query = { first: vi.fn(), update: vi.fn(), delete: vi.fn(), all: vi.fn() };
  return { ...query, where: vi.fn(() => query), orderBy: vi.fn(() => query), create: vi.fn() };
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  const users = mockCollection();
  const memberships = mockCollection();
  const organizations = mockCollection();
  const prisma = { db: { orm: { users, memberships, organizations } } };

  // The first users lookup is always the requester check
  const asSuperadmin = () => users.first.mockResolvedValueOnce(superadmin);

  beforeEach(async () => {
    vi.clearAllMocks();
    users.create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: userId, ...data }));
    memberships.create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: membership._id, ...data }));
    organizations.create.mockImplementation(async (data: Record<string, unknown>) => ({ _id: orgId, ...data }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrganizationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(OrganizationsService);
  });

  it('rejects a requester that is not the superadmin with PERMISSION_DENIED', async () => {
    users.first.mockResolvedValueOnce(ana);

    await expectRpcError(
      service.create({ requester_id: userId, name: 'Acme', slug: 'acme' }),
      status.PERMISSION_DENIED,
    );
    expect(organizations.create).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates an ACTIVE organization', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(null);

      const result = await service.create({ requester_id: superadminId, name: 'Acme', slug: 'acme' });

      expect(users.where).toHaveBeenCalledWith({ _id: superadminId });
      expect(organizations.create).toHaveBeenCalledWith({
        name: 'Acme',
        slug: 'acme',
        status: OrganizationStatus.ACTIVE,
        createdAt: expect.any(Date),
      });
      expect(result).toMatchObject({ id: orgId, name: 'Acme', slug: 'acme', status: OrganizationStatus.ACTIVE });
    });

    it('rejects a taken slug with ALREADY_EXISTS', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(organization);

      await expectRpcError(
        service.create({ requester_id: superadminId, name: 'Acme 2', slug: 'acme' }),
        status.ALREADY_EXISTS,
      );
      expect(organizations.create).not.toHaveBeenCalled();
    });
  });

  it('findAll lists every organization, newest first', async () => {
    asSuperadmin();
    organizations.all.mockResolvedValue([organization]);

    const result = await service.findAll({ requester_id: superadminId });

    expect(organizations.orderBy).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toEqual({
      data: [{ id: orgId, name: 'Acme', slug: 'acme', status: OrganizationStatus.ACTIVE, createdAt: createdAt.toISOString() }],
    });
  });

  it('findOne rejects an unknown organization with NOT_FOUND', async () => {
    asSuperadmin();
    organizations.first.mockResolvedValue(null);

    await expectRpcError(service.findOne({ requester_id: superadminId, id: orgId }), status.NOT_FOUND);
  });

  it('updateStatus suspends an organization', async () => {
    asSuperadmin();
    organizations.first.mockResolvedValue(organization);

    const result = await service.updateStatus({
      requester_id: superadminId,
      id: orgId,
      status: OrganizationStatus.SUSPENDED,
    });

    expect(organizations.update).toHaveBeenCalledWith({ status: OrganizationStatus.SUSPENDED });
    expect(result.status).toBe(OrganizationStatus.SUSPENDED);
  });

  describe('addMember', () => {
    const request = { requester_id: superadminId, organization_id: orgId, email: 'ana@syner.com', role: Role.admin };

    it('creates the user when the email is unknown and adds the membership', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(organization);
      users.first.mockResolvedValueOnce(null);
      memberships.first.mockResolvedValue(null);

      const result = await service.addMember({ ...request, name: 'Ana', password: 'Str0ng!Pass' });

      const stored = users.create.mock.calls[0][0];
      expect(stored).toMatchObject({ name: 'Ana', email: 'ana@syner.com', platform_role: null });
      expect(await bcrypt.compare('Str0ng!Pass', stored.password)).toBe(true);
      expect(memberships.create).toHaveBeenCalledWith({
        user_id: userId,
        organization_id: orgId,
        role: Role.admin,
        createdAt: expect.any(Date),
      });
      expect(result).toEqual({ user_id: userId, name: 'Ana', email: 'ana@syner.com', organization_id: orgId, role: Role.admin });
    });

    it('adds an existing user without touching its name or password', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(organization);
      users.first.mockResolvedValueOnce(ana);
      memberships.first.mockResolvedValue(null);

      const result = await service.addMember({ ...request, name: 'Other', password: 'Other!Pass1' });

      expect(users.create).not.toHaveBeenCalled();
      expect(memberships.create).toHaveBeenCalled();
      expect(result.name).toBe('Ana');
    });

    it('requires name and password for a new user with INVALID_ARGUMENT', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(organization);
      users.first.mockResolvedValueOnce(null);

      await expectRpcError(service.addMember(request), status.INVALID_ARGUMENT);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('rejects a user that is already a member with ALREADY_EXISTS', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(organization);
      users.first.mockResolvedValueOnce(ana);
      memberships.first.mockResolvedValue(membership);

      await expectRpcError(service.addMember(request), status.ALREADY_EXISTS);
      expect(memberships.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown organization with NOT_FOUND', async () => {
      asSuperadmin();
      organizations.first.mockResolvedValue(null);

      await expectRpcError(service.addMember(request), status.NOT_FOUND);
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  it('findMembers lists the members with their role', async () => {
    asSuperadmin();
    organizations.first.mockResolvedValue(organization);
    memberships.all.mockResolvedValue([membership]);
    users.first.mockResolvedValueOnce(ana);

    const result = await service.findMembers({ requester_id: superadminId, id: orgId });

    expect(memberships.where).toHaveBeenCalledWith({ organization_id: orgId });
    expect(result).toEqual({
      data: [{ user_id: userId, name: 'Ana', email: 'ana@syner.com', organization_id: orgId, role: Role.admin }],
    });
  });

  describe('removeMember', () => {
    it('deletes the membership', async () => {
      asSuperadmin();
      memberships.first.mockResolvedValue(membership);
      users.first.mockResolvedValueOnce(ana);

      const result = await service.removeMember({ requester_id: superadminId, organization_id: orgId, user_id: userId });

      expect(memberships.where).toHaveBeenLastCalledWith({ _id: membership._id });
      expect(memberships.delete).toHaveBeenCalled();
      expect(result.user_id).toBe(userId);
    });

    it('rejects a user that is not a member with NOT_FOUND', async () => {
      asSuperadmin();
      memberships.first.mockResolvedValue(null);

      await expectRpcError(
        service.removeMember({ requester_id: superadminId, organization_id: orgId, user_id: userId }),
        status.NOT_FOUND,
      );
      expect(memberships.delete).not.toHaveBeenCalled();
    });
  });
});
