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
pnpm prisma db update         # apply the contract (collection, validator, unique email index) to the DB; compose runs it with --no-interactive on start
```

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time): `PORT`, `DATABASE_URL`, `JWT_SECRET`, optional `JWT_EXPIRES_IN` (`2h`), and the initial owner `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD`.

## Architecture

**gRPC contract is the source of truth.** `src/proto/auth.proto` (package `auth`, service `AuthService`: `RegisterUser`, `LoginUser`, `Verify`, `UpdateUserRole`; enum `Role`: `user | admin | owner`) is compiled by `ts-proto` into `src/generated/proto/auth.ts`; the client-gateway keeps an identical copy. Never hand-edit files under `src/generated/`.

**Bootstrap (`main.ts`)** mirrors orders-ms: `NestFactory.create` + `connectMicroservice(GRPC, { inheritAppConfig: true })` with `loader: { keepCase: true, enums: String }`. Global `ValidationPipe` → `RpcException(INVALID_ARGUMENT)`; `MongoExceptionFilter` maps the MongoDB duplicate key error (11000) → `ALREADY_EXISTS` (detected by shape, not `instanceof`, because pnpm installs more than one copy of `mongodb`). Throw errors as `RpcException({ code: status.X, message })`.

**Auth flow (`AuthService`)**:
- Roles: `owner` (everything + role management), `admin` (full access to products/alerts/purchase orders), `user` (read-only + stock movements). Route permissions are enforced by client-gateway (`@Auth` / `RolesGuard`); auth-ms enforces the user-management rules below.
- `onApplicationBootstrap` → `seedOwner`: creates the `OWNER_*` user with role `owner` if no user has that email (never overwrites an existing one).
- `registerUser` needs `requester_role` (the caller's role, sent by the gateway): `ASSIGNABLE_ROLES` in `src/auth/roles.ts` lets an owner create any role and an admin only `user`, otherwise `PERMISSION_DENIED`. `role` defaults to `user`. Rejects a known email (`ALREADY_EXISTS`), stores the bcrypt hash, `role` and `createdAt`, returns `{ user, token }`.
- `loginUser` answers `UNAUTHENTICATED` / `Invalid credentials` for both unknown email and wrong password.
- `verify` checks the JWT and then **reloads the user by id**, so a role change applies on the next request and a deleted user gets `UNAUTHENTICATED` / `Invalid token`. Returns the user with a freshly signed token (payload: `id`, `name`, `email`, `role`).
- `updateUserRole` (`user_id`, `role`, `requester_id`): the requester must be an owner in the DB (`PERMISSION_DENIED`), cannot change their own role (`PERMISSION_DENIED`, avoids losing the last owner), unknown user → `NOT_FOUND`. Ids are validated with `@IsMongoId()`.
- Users created before roles have no `role` field (the contract has `role String?`); they are read as `user`. Validate role inputs with `@IsIn(ROLES)`, not `@IsEnum(Role)` (that would accept ts-proto's `UNRECOGNIZED`).
- Responses never include the password.

**Prisma 8 (MongoDB)**: contract in `src/prisma/contract.prisma` (no `datasource`, no `@default` support on Mongo; `ObjectId @id @map("_id")`), CLI config in `prisma.config.ts`. `PrismaService` (registered directly in `AuthModule`, no PrismaModule) exposes `db = mongo<Contract>({ contractJson, url })`; query with `db.orm.users.where({...}).first()` / `.create({...})` / `.where({ _id }).update({...})` (no `data:` wrapper; `_id` is a string). Contract changes that make existing documents invalid (e.g. a new required field) are destructive and make `db update` fail on start: prefer optional fields. No Mongo transactions yet in Prisma 8. MongoDB must be **>= 8.0**; compose runs it as a single-node replica set `rs0`.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`). Relative imports use the `.js` extension. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests mock `PrismaService` as `{ db: { orm: { users } } }` and use a real `JwtService` with a test secret.
