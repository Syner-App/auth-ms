import type { User } from '../../generated/proto/auth.js';

// The token carries the public user fields (role included). Verify still reloads the
// user so the role is always the current one
export type JwtPayload = User;
