import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginUserDto, RegisterUserDto, UpdateUserRoleDto } from './dto/index.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';
import { ASSIGNABLE_ROLES } from './roles.js';
import { Role, type AuthResponse, type User } from '../generated/proto/auth.js';
import { envs } from '../config/envs.js';

const SALT_ROUNDS = 10;

interface UserDocument {
  _id: string;
  name: string;
  email: string;
  // Users created before roles existed have none
  role?: string | null;
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
    await this.seedOwner();
  }

  // Creates the initial owner from OWNER_* envs. Idempotent: an existing user with
  // that email is left untouched (its password and role are never overwritten)
  async seedOwner(): Promise<void> {
    const { name, email, password } = envs.owner;
    const existing = await this.prisma.db.orm.users.where({ email }).first();
    if (existing) return;

    await this.createUser({ name, email, password, role: Role.owner });
    this.logger.log(`Owner ${email} created`);
  }

  async registerUser({ name, email, password, role = Role.user, requester_role }: RegisterUserDto): Promise<AuthResponse> {
    if (!ASSIGNABLE_ROLES[requester_role]?.includes(role)) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: `Role ${requester_role} cannot register ${role} users`,
      });
    }

    const existing = await this.prisma.db.orm.users.where({ email }).first();
    if (existing) {
      throw new RpcException({ code: status.ALREADY_EXISTS, message: 'User already exists' });
    }

    const user = await this.createUser({ name, email, password, role });
    return this.toAuthResponse(this.toUserResponse(user));
  }

  async loginUser({ email, password }: LoginUserDto): Promise<AuthResponse> {
    const user = await this.prisma.db.orm.users.where({ email }).first();

    // Same message for unknown email and wrong password: don't reveal which one failed
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid credentials' });
    }

    return this.toAuthResponse(this.toUserResponse(user));
  }

  async verify(token: string): Promise<AuthResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    // Reload the user so a role change applies right away and a deleted user is rejected
    const user = await this.prisma.db.orm.users.where({ _id: payload.id }).first();
    if (!user) {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    return this.toAuthResponse(this.toUserResponse(user));
  }

  async updateUserRole({ user_id, role, requester_id }: UpdateUserRoleDto): Promise<User> {
    // client-gateway already allows owners only; checked again against the database
    const requester = await this.prisma.db.orm.users.where({ _id: requester_id }).first();
    if (!requester || this.roleOf(requester) !== Role.owner) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Only an owner can change roles' });
    }

    // An owner demoting themselves could leave the system without an owner
    if (user_id === requester_id) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'You cannot change your own role' });
    }

    const user = await this.prisma.db.orm.users.where({ _id: user_id }).first();
    if (!user) {
      throw new RpcException({ code: status.NOT_FOUND, message: `User with id ${user_id} not found` });
    }

    await this.prisma.db.orm.users.where({ _id: user_id }).update({ role });
    return this.toUserResponse({ ...user, role });
  }

  private async createUser({ name, email, password, role }: { name: string; email: string; password: string; role: Role }) {
    // A concurrent register with the same email still hits the unique index,
    // which MongoExceptionFilter maps to ALREADY_EXISTS
    return this.prisma.db.orm.users.create({
      name,
      email,
      password: await bcrypt.hash(password, SALT_ROUNDS),
      role,
      createdAt: new Date(),
    });
  }

  private async toAuthResponse(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = { id: user.id, name: user.name, email: user.email, role: user.role };
    return { user, token: await this.jwtService.signAsync(payload) };
  }

  // Never expose the password hash
  private toUserResponse(user: UserDocument): User {
    const { _id, name, email } = user;
    return { id: _id, name, email, role: this.roleOf(user) };
  }

  private roleOf({ role }: UserDocument): Role {
    return (role as Role | null | undefined) ?? Role.user;
  }
}
