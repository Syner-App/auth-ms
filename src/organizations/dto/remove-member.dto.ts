import { IsMongoId } from 'class-validator';
import { RequesterDto } from './requester.dto.js';

export class RemoveMemberDto extends RequesterDto {
  @IsMongoId()
  public organization_id: string;

  @IsMongoId()
  public user_id: string;
}
