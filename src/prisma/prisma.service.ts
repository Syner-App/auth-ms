import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import mongo from '@prisma/orm-mongo/runtime';
import type { Contract } from './contract.js';
import contractJson from './contract.json' with { type: 'json' };
import { envs } from '../config/envs.js';

// Prisma 8 MongoDB client. Queries go through `db.orm.<collection>`, e.g. db.orm.users
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(`PrismaService`);

  readonly db = mongo<Contract>({ contractJson, url: envs.databaseUrl });

  // The client connects lazily on the first query; connecting here makes a bad
  // DATABASE_URL fail at startup instead of on the first request
  async onModuleInit() {
    await this.db.connect();
    this.logger.log(`Database connected`);
  }

  async onModuleDestroy() {
    await this.db.close();
    this.logger.log(`Database disconnect`);
  }
}
