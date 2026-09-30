import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginUserDto, RegisterUserDto } from './dto/index.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';
import type { AuthResponse, User } from '../generated/proto/auth.js';

const SALT_ROUNDS = 10;

interface UserDocument {
  _id: string;
  name: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  async registerUser({ name, email, password }: RegisterUserDto): Promise<AuthResponse> {
    const existing = await this.prisma.db.orm.users.where({ email }).first();
    if (existing) {
      throw new RpcException({ code: status.ALREADY_EXISTS, message: 'User already exists' });
    }

    // A concurrent register with the same email still hits the unique index,
    // which MongoExceptionFilter maps to ALREADY_EXISTS
    const user = await this.prisma.db.orm.users.create({
      name,
      email,
      password: await bcrypt.hash(password, SALT_ROUNDS),
      createdAt: new Date(),
    });

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
    let payload: JwtPayload & { iat?: number; exp?: number };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid token' });
    }

    const { iat: _iat, exp: _exp, ...user } = payload;
    return this.toAuthResponse(user);
  }

  private async toAuthResponse(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = { id: user.id, name: user.name, email: user.email };
    return { user, token: await this.jwtService.signAsync(payload) };
  }

  // Never expose the password hash
  private toUserResponse({ _id, name, email }: UserDocument): User {
    return { id: _id, name, email };
  }
}
