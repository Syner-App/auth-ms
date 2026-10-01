import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import type {
  MembershipDocument,
  OrganizationDocument,
  UserDocument,
} from '../auth/interfaces/documents.interface.js';
import {
  OrganizationStatus,
  PlatformRole,
  Role,
  type Member,
  type MemberList,
  type Organization,
  type OrganizationList,
} from '../generated/proto/auth.js';
import {
  AddMemberDto,
  CreateOrganizationDto,
  CurrentOrganizationDto,
  OrganizationByIdDto,
  RemoveMemberDto,
  RequesterDto,
  UpdateCurrentOrganizationDto,
  UpdateOrganizationStatusDto,
} from './dto/index.js';

// Roles that can manage their own organization (FindCurrent, members)
const MANAGER_ROLES: readonly string[] = [Role.owner, Role.admin];

// Organizations and their members. The platform methods first check against the database
// that the requester is the superadmin; the *Current* ones that it is an owner or admin of
// its own organization (client-gateway checks both too)
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) { }

  async create({ requester_id, name, slug }: CreateOrganizationDto): Promise<Organization> {
    await this.assertSuperadmin(requester_id);

    const existing = await this.prisma.db.orm.organizations.where({ slug }).first();
    if (existing) {
      throw new RpcException({ code: status.ALREADY_EXISTS, message: `Organization ${slug} already exists` });
    }

    // A concurrent create with the same slug still hits the unique index,
    // which MongoExceptionFilter maps to ALREADY_EXISTS
    const organization = await this.prisma.db.orm.organizations.create({
      name,
      slug,
      status: OrganizationStatus.ACTIVE,
      createdAt: new Date(),
    });
    return this.toOrganizationResponse(organization);
  }

  async findAll({ requester_id }: RequesterDto): Promise<OrganizationList> {
    await this.assertSuperadmin(requester_id);

    const organizations = await this.prisma.db.orm.organizations.orderBy({ createdAt: -1 }).all();
    return { data: organizations.map((organization) => this.toOrganizationResponse(organization)) };
  }

  async findOne({ requester_id, id }: OrganizationByIdDto): Promise<Organization> {
    await this.assertSuperadmin(requester_id);
    return this.toOrganizationResponse(await this.findOrganization(id));
  }

  async updateStatus({ requester_id, id, status: newStatus }: UpdateOrganizationStatusDto): Promise<Organization> {
    await this.assertSuperadmin(requester_id);

    const organization = await this.findOrganization(id);
    await this.prisma.db.orm.organizations.where({ _id: id }).update({ status: newStatus });
    return this.toOrganizationResponse({ ...organization, status: newStatus });
  }

  async addMember(addMemberDto: AddMemberDto): Promise<Member> {
    await this.assertSuperadmin(addMemberDto.requester_id);
    return this.createMember(addMemberDto);
  }

  async findMembers({ requester_id, id }: OrganizationByIdDto): Promise<MemberList> {
    await this.assertSuperadmin(requester_id);
    return this.listMembers(id);
  }

  async removeMember({ requester_id, organization_id, user_id }: RemoveMemberDto): Promise<Member> {
    await this.assertSuperadmin(requester_id);
    return this.deleteMember(organization_id, user_id);
  }

  async findCurrent({ requester_id, organization_id }: CurrentOrganizationDto): Promise<Organization> {
    await this.assertMembershipRole(requester_id, organization_id, MANAGER_ROLES);
    return this.toOrganizationResponse(await this.findOrganization(organization_id));
  }

  async updateCurrent({ requester_id, organization_id, name }: UpdateCurrentOrganizationDto): Promise<Organization> {
    await this.assertMembershipRole(requester_id, organization_id, [Role.owner]);

    // The slug identifies the organization and stays fixed
    const organization = await this.findOrganization(organization_id);
    await this.prisma.db.orm.organizations.where({ _id: organization_id }).update({ name });
    return this.toOrganizationResponse({ ...organization, name });
  }

  async findCurrentMembers({ requester_id, organization_id }: CurrentOrganizationDto): Promise<MemberList> {
    await this.assertMembershipRole(requester_id, organization_id, MANAGER_ROLES);
    return this.listMembers(organization_id);
  }

  async addCurrentMember(addMemberDto: AddMemberDto): Promise<Member> {
    const { requester_id, organization_id, role } = addMemberDto;
    const requester = await this.assertMembershipRole(requester_id, organization_id, MANAGER_ROLES);

    // Only an owner can hand out owner or admin
    if (requester.role !== Role.owner && role !== Role.user) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'An admin can only add members with role user' });
    }
    return this.createMember(addMemberDto);
  }

  async removeCurrentMember({ requester_id, organization_id, user_id }: RemoveMemberDto): Promise<Member> {
    const requester = await this.assertMembershipRole(requester_id, organization_id, MANAGER_ROLES);

    // An owner never removes themselves, so the organization never ends up without one
    if (user_id === requester_id) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'You cannot remove yourself' });
    }

    if (requester.role !== Role.owner) {
      const target = await this.prisma.db.orm.memberships.where({ user_id, organization_id }).first();
      if (target && target.role !== Role.user) {
        throw new RpcException({ code: status.PERMISSION_DENIED, message: 'An admin can only remove members with role user' });
      }
    }
    return this.deleteMember(organization_id, user_id);
  }

  private async createMember({ organization_id, email, role, name, password }: AddMemberDto): Promise<Member> {
    await this.findOrganization(organization_id);

    // An existing user keeps its name and password: only the membership is added
    let user: UserDocument | null = await this.prisma.db.orm.users.where({ email }).first();
    if (!user) {
      if (!name || !password) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'name and password are required to create a new user',
        });
      }
      user = await this.prisma.db.orm.users.create({
        name,
        email,
        password: await hashPassword(password),
        platform_role: null,
        createdAt: new Date(),
      });
    }

    const existing = await this.prisma.db.orm.memberships.where({ user_id: user._id, organization_id }).first();
    if (existing) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `User ${email} is already a member of the organization`,
      });
    }

    // The unique (user_id, organization_id) index guards against a concurrent add
    const membership = await this.prisma.db.orm.memberships.create({
      user_id: user._id,
      organization_id,
      role,
      createdAt: new Date(),
    });
    return this.toMemberResponse(user, membership);
  }

  private async listMembers(id: string): Promise<MemberList> {
    await this.findOrganization(id);

    const memberships = await this.prisma.db.orm.memberships.where({ organization_id: id }).all();
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await this.prisma.db.orm.users.where({ _id: membership.user_id }).first();
        return user ? this.toMemberResponse(user, membership) : null;
      }),
    );
    return { data: members.filter((member): member is Member => member !== null) };
  }

  private async deleteMember(organization_id: string, user_id: string): Promise<Member> {
    const membership = await this.prisma.db.orm.memberships.where({ user_id, organization_id }).first();
    const user = membership && (await this.prisma.db.orm.users.where({ _id: user_id }).first());
    if (!membership || !user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id ${user_id} not found in the organization`,
      });
    }

    // The user's tokens for this organization stop working on the next Verify
    await this.prisma.db.orm.memberships.where({ _id: membership._id }).delete();
    return this.toMemberResponse(user, membership);
  }

  private async assertSuperadmin(requester_id: string): Promise<void> {
    const requester = await this.prisma.db.orm.users.where({ _id: requester_id }).first();
    if (requester?.platform_role !== PlatformRole.superadmin) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Only the platform superadmin can manage organizations' });
    }
  }

  // The requester's membership in the organization when its role is one of `roles`
  private async assertMembershipRole(
    requester_id: string,
    organization_id: string,
    roles: readonly string[],
  ): Promise<MembershipDocument> {
    const membership = await this.prisma.db.orm.memberships.where({ user_id: requester_id, organization_id }).first();
    if (!membership || !roles.includes(membership.role)) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'You cannot manage this organization' });
    }
    return membership;
  }

  private async findOrganization(id: string): Promise<OrganizationDocument> {
    const organization = await this.prisma.db.orm.organizations.where({ _id: id }).first();
    if (!organization) {
      throw new RpcException({ code: status.NOT_FOUND, message: `Organization with id ${id} not found` });
    }
    return organization;
  }

  private toOrganizationResponse({ _id, name, slug, status, createdAt }: OrganizationDocument): Organization {
    return { id: _id, name, slug, status: status as OrganizationStatus, createdAt: createdAt.toISOString() };
  }

  private toMemberResponse(user: UserDocument, membership: MembershipDocument): Member {
    return {
      user_id: user._id,
      name: user.name,
      email: user.email,
      organization_id: membership.organization_id,
      role: membership.role as Role,
    };
  }
}
