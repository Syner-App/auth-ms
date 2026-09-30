import { OrganizationStatus, Role } from '../generated/proto/auth.js';

// Valid organization roles (ts-proto's UNRECOGNIZED is not one)
export const ROLES = [Role.owner, Role.admin, Role.user] as const;

// Valid organization statuses
export const ORGANIZATION_STATUSES = [OrganizationStatus.ACTIVE, OrganizationStatus.SUSPENDED] as const;
