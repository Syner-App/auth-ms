import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { RequesterDto } from './requester.dto.js';

// The requester's own organization, taken by client-gateway from its token
export class CurrentOrganizationDto extends RequesterDto {
  @IsMongoId()
  public organization_id: string;
}

export class UpdateCurrentOrganizationDto extends CurrentOrganizationDto {
  @IsString()
  @IsNotEmpty()
  public name: string;
}
