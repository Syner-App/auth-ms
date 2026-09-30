// MongoDB documents as the Prisma 8 ORM returns them (ObjectIds as strings)

export interface UserDocument {
  _id: string;
  name: string;
  email: string;
  // Only the platform superadmin has one
  platform_role?: string | null;
}

export interface OrganizationDocument {
  _id: string;
  name: string;
  slug: string;
  // OrganizationStatus from auth.proto
  status: string;
  createdAt: Date;
}

export interface MembershipDocument {
  _id: string;
  user_id: string;
  organization_id: string;
  // Role from auth.proto
  role: string;
}
