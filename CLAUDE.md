# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`auth-ms` is the authentication microservice of the **Syner** project. NestJS 12 app with **no HTTP server**: it serves its API over **gRPC** only. Users live in **MongoDB** (collection `users`) through **Prisma ORM 8** (`@prisma/orm-mongo`, release candidate: Prisma 7 has no MongoDB connector). Passwords are hashed with `bcryptjs` and sessions are stateless **JWTs** (`@nestjs/jwt`).

## Commands

Package manager is **pnpm**.

```bash
docker compose up -d --build  # from the syner/ root: whole stack (MongoDB replica set auth-db, all services in watch mode)
pnpm start:dev                # run with watch (needs MongoDB, see .env.template)
pnpm build                    # nest build → dist/ (copies **/*.proto as assets)
pnpm lint                     # oxlint --type-aware src/ test/
pnpm test                     # vitest unit tests (**/*.spec.ts)

pnpm proto:gen                # regenerate src/generated/proto/auth.ts from src/proto/auth.proto
pnpm prisma contract emit     # regenerate src/prisma/contract.json + contract.d.ts (committed) after editing contract.prisma
pnpm prisma db init           # create collections/indexes (unique email) from the contract; idempotent
```

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time): `PORT`, `DATABASE_URL`, `JWT_SECRET`, optional `JWT_EXPIRES_IN` (`2h`).

## Architecture

**gRPC contract is the source of truth.** `src/proto/auth.proto` (package `auth`, service `AuthService`: `RegisterUser`, `LoginUser`, `Verify`) is compiled by `ts-proto` into `src/generated/proto/auth.ts`; the client-gateway keeps an identical copy. Never hand-edit files under `src/generated/`.

**Bootstrap (`main.ts`)** mirrors orders-ms: `NestFactory.create` + `connectMicroservice(GRPC, { inheritAppConfig: true })` with `loader: { keepCase: true, enums: String }`. Global `ValidationPipe` → `RpcException(INVALID_ARGUMENT)`; `MongoExceptionFilter` maps the MongoDB duplicate key error (11000) → `ALREADY_EXISTS` (detected by shape, not `instanceof`, because pnpm installs more than one copy of `mongodb`). Throw errors as `RpcException({ code: status.X, message })`.

**Auth flow (`AuthService`)**:
- `registerUser` rejects a known email (`ALREADY_EXISTS`), stores the bcrypt hash and `createdAt`, returns `{ user, token }`.
- `loginUser` answers `UNAUTHENTICATED` / `Invalid credentials` for both unknown email and wrong password.
- `verify` checks the JWT (`UNAUTHENTICATED` / `Invalid token`) and returns its user with a freshly signed token. The token payload is the public `User` (`id`, `name`, `email`), so no database lookup is needed.
- Responses never include the password.

**Prisma 8 (MongoDB)**: contract in `src/prisma/contract.prisma` (no `datasource`, no `@default` support on Mongo; `ObjectId @id @map("_id")`), CLI config in `prisma.config.ts`. `PrismaService` (registered directly in `AuthModule`, no PrismaModule) exposes `db = mongo<Contract>({ contractJson, url })`; query with `db.orm.users.where({...}).first()` / `.create({...})` (no `data:` wrapper; `_id` is a string). No Mongo transactions yet in Prisma 8. MongoDB must be **>= 8.0**; compose runs it as a single-node replica set `rs0`.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`). Relative imports use the `.js` extension. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests mock `PrismaService` as `{ db: { orm: { users } } }` and use a real `JwtService` with a test secret.
