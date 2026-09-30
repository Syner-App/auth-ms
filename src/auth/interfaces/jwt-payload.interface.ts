// The token only identifies the user and the organization it is scoped to. Verify reloads
// the user, membership and organization, so role and status are always the current ones
export interface JwtPayload {
  id: string;
  organization_id?: string;
}
