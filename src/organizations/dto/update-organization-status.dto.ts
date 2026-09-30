import { IsIn } from 'class-validator';
import type { OrganizationStatus } from '../../generated/proto/auth.js';
import { ORGANIZATION_STATUSES } from '../../auth/roles.js';
import { OrganizationByIdDto } from './organization-by-id.dto.js';

export class UpdateOrganizationStatusDto extends OrganizationByIdDto {
  @IsIn(ORGANIZATION_STATUSES)
  public status: OrganizationStatus;
}
