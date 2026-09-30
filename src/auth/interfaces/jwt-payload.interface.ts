import type { User } from '../../generated/proto/auth.js';

// The token carries the public user fields, so Verify needs no database lookup
export type JwtPayload = User;
