import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { OrganizationsService } from './organizations.service.js';
import {
  AddMemberDto,
  CreateOrganizationDto,
  CurrentOrganizationDto,
  OrganizationByIdDto,
  RemoveMemberDto,
  RequesterDto,
  UpdateCurrentOrganizationDto,
  UpdateOrganizationStatusDto,
} from './dto/index.js';
import { ORGANIZATIONS_SERVICE_NAME } from '../generated/proto/auth.js';

@Controller()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) { }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'Create')
  create(@Payload() createOrganizationDto: CreateOrganizationDto) {
    return this.organizationsService.create(createOrganizationDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'FindAll')
  findAll(@Payload() requesterDto: RequesterDto) {
    return this.organizationsService.findAll(requesterDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'FindOne')
  findOne(@Payload() organizationByIdDto: OrganizationByIdDto) {
    return this.organizationsService.findOne(organizationByIdDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'UpdateStatus')
  updateStatus(@Payload() updateOrganizationStatusDto: UpdateOrganizationStatusDto) {
    return this.organizationsService.updateStatus(updateOrganizationStatusDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'AddMember')
  addMember(@Payload() addMemberDto: AddMemberDto) {
    return this.organizationsService.addMember(addMemberDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'FindMembers')
  findMembers(@Payload() organizationByIdDto: OrganizationByIdDto) {
    return this.organizationsService.findMembers(organizationByIdDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'RemoveMember')
  removeMember(@Payload() removeMemberDto: RemoveMemberDto) {
    return this.organizationsService.removeMember(removeMemberDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'FindCurrent')
  findCurrent(@Payload() currentOrganizationDto: CurrentOrganizationDto) {
    return this.organizationsService.findCurrent(currentOrganizationDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'UpdateCurrent')
  updateCurrent(@Payload() updateCurrentOrganizationDto: UpdateCurrentOrganizationDto) {
    return this.organizationsService.updateCurrent(updateCurrentOrganizationDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'FindCurrentMembers')
  findCurrentMembers(@Payload() currentOrganizationDto: CurrentOrganizationDto) {
    return this.organizationsService.findCurrentMembers(currentOrganizationDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'AddCurrentMember')
  addCurrentMember(@Payload() addMemberDto: AddMemberDto) {
    return this.organizationsService.addCurrentMember(addMemberDto);
  }

  @GrpcMethod(ORGANIZATIONS_SERVICE_NAME, 'RemoveCurrentMember')
  removeCurrentMember(@Payload() removeMemberDto: RemoveMemberDto) {
    return this.organizationsService.removeCurrentMember(removeMemberDto);
  }
}
