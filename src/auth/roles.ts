import { Role } from '../generated/proto/auth.js';

// Valid roles (ts-proto's UNRECOGNIZED is not one)
export const ROLES = [Role.owner, Role.admin, Role.user] as const;

// Roles each caller may give to a new user: owner any role, admin only user
export const ASSIGNABLE_ROLES: Partial<Record<Role, readonly Role[]>> = {
  [Role.owner]: ROLES,
  [Role.admin]: [Role.user],
};
