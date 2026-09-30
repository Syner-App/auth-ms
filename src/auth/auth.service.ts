import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginUserDto, SwitchOrganizationDto, UpdateUserRoleDto } from './dto/index.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';
import type { MembershipDocument, OrganizationDocument, UserDocument } from './interfaces/documents.interface.js';
import { hashPassword } from './password.js';
import {
  OrganizationStatus,
  PlatformRole,
  Role,
  type AuthResponse,
  type Membership,
  type User,
} from '../generated/proto/auth.js';
import { envs } from '../config/envs.js';

// An active membership with its organization loaded
interface ActiveMembership {
  membership: MembershipDocument;
  organization: OrganizationDocument;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(`AuthService`);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  // Runs after PrismaService connected (onModuleInit), before any call is served
  async onApplicationBootstrap() {
    await this.seedSuperadmin();
  }

  // Creates the platform superadmin from SUPERADMIN_* envs. Idempotent: an existing user
  // with that email is left untouched (its password and role are never overwritten)
  async seedSuperadmin(): Promise<void> {
    const { name, email, password } = envs.superadmin;
    const existing = await this.prisma.db.orm.users.where({ email }).first();
    if (existing) return;

    await this.prisma.db.orm.users.create({
      name,
      email,
      password: await hashPassword(password),
      platform_role: PlatformRole.superadmin,
      createdAt: new Date(),
    });
    this.logger.log(`Superadmin ${email} created`);
  }

  async loginUser({ email, password, organization_id }: LoginUserDto): Promise<AuthResponse> {
    const user = await this.prisma.db.orm.users.where({ email }).first();

    // Same message for unknown email and wrong password: don't reveal which one failed
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid credentials' });
    }

    const memberships = await this.activeMemberships(user._id);
    const memberships_response = memberships.map((active) => this.toMembershipResponse(active));

    if (organization_id) {
      const selected = memberships.find(({ organization }) => organization._id === organization_id);
      if (!selected) {
        throw new RpcException({
          code: status.PERMISSION_DENIED,
          message: 'You are not a member of this organization',
        });
      }
      return this.toAuthResponse(user, selected, memberships_response);
    }

    // A superadmin works on the platform, not inside an organization
    if (!this.isSuperadmin(user) && memberships.length === 0) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'You do not belong to any active organization',
      });
    }

    // One organization: scope the token to it. Several: the client picks one (SwitchOrganization)
    const scope = memberships.length === 1 ? memberships[0] : undefined;
    return this.toAuthResponse(user, scope, memberships_response);
  }

  async switchOrganization({ requester_id, organization_id }: SwitchOrganizationDto): Promise<AuthResponse> {
    const user = await this.prisma.db.orm.users.where({ _id: requester_id }).first();
    if (!user) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    const active = await this.activeMembership(requester_id, organization_id);
    return this.toAuthResponse(user, active);
  }

  async verify(token: string): Promise<AuthResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    // Reload the user so a deleted user is rejected
    const user = await this.prisma.db.orm.users.where({ _id: payload.id }).first();
    if (!user) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    // Reload the membership and organization so a role change, a removed membership or a
    // suspended organization apply right away
    const active = payload.organization_id
      ? await this.activeMembership(user._id, payload.organization_id, status.UNAUTHENTICATED)
      : undefined;

    return this.toAuthResponse(user, active);
  }

  async updateUserRole({ user_id, role, requester_id, organization_id }: UpdateUserRoleDto): Promise<User> {
    // client-gateway already allows owners only; checked again against the database
    const requester = await this.findMembership(requester_id, organization_id);
    if (!requester || requester.role !== Role.owner) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Only an owner of the organization can change roles',
      });
    }

    // An owner demoting themselves could leave the organization without an owner
    if (user_id === requester_id) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'You cannot change your own role' });
    }

    const membership = await this.findMembership(user_id, organization_id);
    const user = membership && (await this.prisma.db.orm.users.where({ _id: user_id }).first());
    if (!membership || !user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id ${user_id} not found in the organization`,
      });
    }

    await this.prisma.db.orm.memberships.where({ _id: membership._id }).update({ role });
    return { ...this.toUserResponse(user), organization_id, role };
  }

  private findMembership(user_id: string, organization_id: string): Promise<MembershipDocument | null> {
    return this.prisma.db.orm.memberships.where({ user_id, organization_id }).first();
  }

  // The membership of the user in an ACTIVE organization, or an error. `missingCode` is the
  // status for a missing membership: PERMISSION_DENIED on a request, UNAUTHENTICATED when a
  // token points to a membership that no longer exists
  private async activeMembership(
    user_id: string,
    organization_id: string,
    missingCode: status = status.PERMISSION_DENIED,
  ): Promise<ActiveMembership> {
    const membership = await this.findMembership(user_id, organization_id);
    const organization = membership && (await this.prisma.db.orm.organizations.where({ _id: organization_id }).first());
    if (!membership || !organization) {
      throw new RpcException({ code: missingCode, message: 'You are not a member of this organization' });
    }

    if (organization.status !== OrganizationStatus.ACTIVE) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'The organization is suspended' });
    }
    return { membership, organization };
  }

  // Memberships of the user whose organization is ACTIVE
  private async activeMemberships(user_id: string): Promise<ActiveMembership[]> {
    const memberships = await this.prisma.db.orm.memberships.where({ user_id }).all();
    const loaded = await Promise.all(
      memberships.map(async (membership): Promise<ActiveMembership | null> => {
        const organization = await this.prisma.db.orm.organizations.where({ _id: membership.organization_id }).first();
        return organization?.status === OrganizationStatus.ACTIVE ? { membership, organization } : null;
      }),
    );
    return loaded.filter((active) => active !== null);
  }

  private async toAuthResponse(
    user: UserDocument,
    active?: ActiveMembership,
    memberships: Membership[] = [],
  ): Promise<AuthResponse> {
    const response: User = { ...this.toUserResponse(user) };
    if (active) {
      response.organization_id = active.organization._id;
      response.role = active.membership.role as Role;
    }

    const payload: JwtPayload = { id: response.id, organization_id: response.organization_id };
    return { user: response, token: await this.jwtService.signAsync(payload), memberships };
  }

  private toMembershipResponse({ membership, organization }: ActiveMembership): Membership {
    return {
      organization_id: organization._id,
      organization_name: organization.name,
      organization_slug: organization.slug,
      role: membership.role as Role,
    };
  }

  // Never expose the password hash
  private toUserResponse(user: UserDocument): User {
    const { _id, name, email } = user;
    return this.isSuperadmin(user)
      ? { id: _id, name, email, platform_role: PlatformRole.superadmin }
      : { id: _id, name, email };
  }

  private isSuperadmin({ platform_role }: UserDocument): boolean {
    return platform_role === PlatformRole.superadmin;
  }
}
