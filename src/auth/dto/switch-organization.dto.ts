import { IsMongoId } from 'class-validator';

export class SwitchOrganizationDto {
  // Id of the authenticated caller, set by client-gateway
  @IsMongoId()
  public requester_id: string;

  @IsMongoId()
  public organization_id: string;
}
