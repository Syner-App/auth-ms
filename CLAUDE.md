# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`auth-ms` is the authentication microservice and the **multitenancy control plane** of the **Syner** project. NestJS 12 app with **no HTTP server**: it serves its API over **gRPC** only. Users, organizations and memberships live in **MongoDB** (collections `users`, `organizations`, `memberships`) through **Prisma ORM 8** (`@prisma/orm-mongo`, release candidate: Prisma 7 has no MongoDB connector). Passwords are hashed with `bcryptjs` and sessions are stateless **JWTs** (`@nestjs/jwt`).

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
pnpm prisma db update         # apply the contract (collections, validators, unique indexes) to the DB; compose runs it with --no-interactive on start
```

Env vars (see `.env.template`, validated with Joi in `src/config/envs.ts` at import time): `PORT`, `DATABASE_URL`, `JWT_SECRET`, optional `JWT_EXPIRES_IN` (`2h`), and the platform superadmin `SUPERADMIN_NAME`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`.

## Architecture

**gRPC contract is the source of truth.** `src/proto/auth.proto` (package `auth`) declares two services: `AuthService` (`LoginUser`, `SwitchOrganization`, `Verify`, `UpdateUserRole`) and `OrganizationsService` (`Create`, `FindAll`, `FindOne`, `UpdateStatus`, `AddMember`, `FindMembers`, `RemoveMember`), plus the enums `Role` (`user | admin | owner`), `PlatformRole` (`superadmin`) and `OrganizationStatus` (`ACTIVE | SUSPENDED`). It is compiled by `ts-proto` into `src/generated/proto/auth.ts`; the client-gateway keeps an identical copy. Never hand-edit files under `src/generated/`.

**Bootstrap (`main.ts`)** mirrors orders-ms: `NestFactory.create` + `connectMicroservice(GRPC, { inheritAppConfig: true })` with `loader: { keepCase: true, enums: String }`. Global `ValidationPipe` → `RpcException(INVALID_ARGUMENT)`; `MongoExceptionFilter` maps the MongoDB duplicate key error (11000) → `ALREADY_EXISTS` (detected by shape, not `instanceof`, because pnpm installs more than one copy of `mongodb`). Throw errors as `RpcException({ code: status.X, message })`.

**Multitenancy model**: an `Organization` is a tenant (products-ms and orders-ms scope every row by its id, `organization_id`). A `Membership` (`user_id`, `organization_id`, `role`, unique per pair) gives a user a role inside one organization; a user may belong to several. `User.platform_role` is only set for the platform **superadmin**, who manages organizations and members but works outside any organization.

**Auth flow (`AuthService`)**:
- Organization roles: `owner` (whole organization + role management), `admin` (full access to products/alerts/purchase orders), `user` (read-only + stock movements). Route permissions are enforced by client-gateway (`@Auth` / `RolesGuard` / `@PlatformAdmin`); auth-ms enforces the user-management rules below.
- `onApplicationBootstrap` → `seedSuperadmin`: creates the `SUPERADMIN_*` user with `platform_role: superadmin` if no user has that email (never overwrites an existing one).
- JWT payload is only `{ id, organization_id? }`: the organization the token is scoped to. Role and status are never trusted from the token.
- `loginUser` (`email`, `password`, optional `organization_id`): `UNAUTHENTICATED` / `Invalid credentials` for both unknown email and wrong password. Only memberships of `ACTIVE` organizations count. With `organization_id` the token is scoped to it (`PERMISSION_DENIED` if not a member); otherwise a user with exactly one membership gets a token for it, and a user with several (or the superadmin) gets a token without organization. A non-superadmin with no active membership → `PERMISSION_DENIED`. The response lists the active `memberships`.
- `switchOrganization` (`requester_id`, `organization_id`): token scoped to another organization of the caller (`PERMISSION_DENIED` if not a member or suspended).
- `verify` checks the JWT and then **reloads the user, and for a scoped token the membership and organization**, so a role change, a removed membership (`UNAUTHENTICATED`) or a suspended organization (`PERMISSION_DENIED`) apply on the next request. Returns the user (with `organization_id` and `role` when scoped) and a freshly signed token.
- `updateUserRole` (`user_id`, `role`, `requester_id`, `organization_id`): the requester must be an owner of that organization in the DB (`PERMISSION_DENIED`), cannot change their own role (`PERMISSION_DENIED`, avoids losing the last owner), a user that is not a member → `NOT_FOUND`. It updates the membership, not the user.
- Validate role and status inputs with `@IsIn(ROLES)` / `@IsIn(ORGANIZATION_STATUSES)` (`src/auth/roles.ts`), not `@IsEnum(...)` (that would accept ts-proto's `UNRECOGNIZED`). Ids are validated with `@IsMongoId()`.
- Responses never include the password.

**Organizations (`OrganizationsService`, `src/organizations/`)**: every call carries `requester_id` and first checks in the DB that it is the superadmin (`PERMISSION_DENIED`). `create` stores an `ACTIVE` organization (slug unique, lowercase and dashes). `findAll` returns every organization, newest first (no pagination: the ORM has no `count`). `addMember` creates the user when the email is unknown (`name` and `password` then required, else `INVALID_ARGUMENT`), keeps an existing user untouched, and rejects a duplicate membership (`ALREADY_EXISTS`). `removeMember` deletes the membership; the user's tokens for that organization fail on the next `verify`. `OrganizationsModule` imports `AuthModule` to reuse its `PrismaService` (a single MongoDB client).

**Prisma 8 (MongoDB)**: contract in `src/prisma/contract.prisma` (no `datasource`, no `@default` support on Mongo; `ObjectId @id @map("_id")`), CLI config in `prisma.config.ts`. `PrismaService` (registered directly in `AuthModule`, no PrismaModule) exposes `db = mongo<Contract>({ contractJson, url })`; query with `db.orm.users.where({...}).first()` / `.all()` / `.create({...})` / `.where({ _id }).update({...})` / `.delete()` (no `data:` wrapper; `_id` and other `ObjectId` fields are strings). Compound unique indexes work (`@@unique([user_id, organization_id])`). Contract changes that make existing documents invalid (e.g. a new required field) are destructive and make `db update` fail on start: prefer optional fields. No Mongo transactions yet in Prisma 8. MongoDB must be **>= 8.0**; compose runs it as a single-node replica set `rs0`.

## Conventions

- ESM project (`"type": "module"`, `module: nodenext`). Relative imports use the `.js` extension. Use `import.meta.dirname` instead of `__dirname`.
- Unit tests mock `PrismaService` as `{ db: { orm: { users, memberships, organizations } } }` (each collection's `where()` returns `{ first, update, delete, all }`) and use a real `JwtService` with a test secret.
