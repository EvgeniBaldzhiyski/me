import { TargetDataState } from '../../utils/comm.map';
import { BusinessSector, PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}

export type timestamp = number;

export interface SwitzerlandPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  addressInSlovenia: PostingInfoAddress;
  residencePermitDate: timestamp;
  grossHourlyWage: string;
  socialInsuranceNumber: string;
  trade: string;
  occupation: string;
  professionalQualification: string;
  currency: string;
}

export interface SwitzerlandPostingInfo extends PostingInfo {
  employeeAdditionalInfo: SwitzerlandPostingAdditionalInfoEmployee[];
  hostCompanyContactPersonFax?: string;
  purposeOfService: string;
  postCompanyBusinessSectorsDto: BusinessSector[];
  workplaceAddress: PostingInfoAddress;
}
