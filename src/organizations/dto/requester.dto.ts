import { IsMongoId } from 'class-validator';

// Every OrganizationsService call carries the authenticated caller, set by client-gateway.
// auth-ms checks it is the platform superadmin
export class RequesterDto {
  @IsMongoId()
  public requester_id: string;
}
