import { IsMongoId } from 'class-validator';
import { RequesterDto } from './requester.dto.js';

export class OrganizationByIdDto extends RequesterDto {
  @IsMongoId()
  public id: string;
}
