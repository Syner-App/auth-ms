import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { RequesterDto } from './requester.dto.js';

export class CreateOrganizationDto extends RequesterDto {
  @IsString()
  @IsNotEmpty()
  public name: string;

  // Lowercase letters and numbers, dash separated (e.g. acme-foods)
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters and numbers separated by dashes' })
  public slug: string;
}
