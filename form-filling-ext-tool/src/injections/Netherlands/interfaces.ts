import { TargetDataState, timestamp } from '../../utils/comm.map';
import { PostingAdditionalInfoEmployee, PostingInfo } from '../../utils/interfaces';

interface responseCompanyAddress {
  postcode: string;
  city: string;
  street: string;
  streetNumber: string;
}

export enum PerformedWorkAddressType {
  NONE = 'None',
  GEO_LOCATION = 'GEO-Location',
  TRANSPORT = 'Transport',
  SPREAD_SINGLE = 'Spread across multiple regions/places (single Service recipient)',
  SPREAD_MULTIPLE = 'Spread across multiple regions/places (multiple Service recipients)',
}

export interface NetherlandsPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  endDateEEAWorkPermit: timestamp;
  responseCompanyName: string;
  citizenServiceNumber: string;
  certificateNumber: string;
  countryOfIssue: string;
  certificateApplyCountry: string;
  socialContributionPaidCountry: string;
  provideEvidence: boolean;
}

export interface NetherlandsPostingInfo extends PostingInfo {
  employeeAdditionalInfo: NetherlandsPostingAdditionalInfoEmployee[];
  responseCompanyName?: string;
  licensePlateVehicle?: string;
  performedWorkAddressType?: PerformedWorkAddressType;
  hostCompanyRSINNumber?: string;
  hostCompanyBranchNumber?: string;
  hostCompanyKVKNumber?: string;
  contactCitizenServiceNumber?: string;
  representativeCitizenServiceNumber?: string;
  postCompanyBranchNumber?: string;
  postCompanyRSINNumber?: string;
  postCompanyKVKNumber?: string;
  responseCompanyCountry?: string;
  responseCompanyKVKNumber?: string;
  responseCompanyBranchNumber?: string;
  responseCompanyRegistrationNumber?: string;
  responseCompanyVatNumber?: string;
  responseCompanyEmail?: string;
  responseCompanyTelephone?: string;
  responseCompanyAddress: responseCompanyAddress;
  postCompanyBusinessSectorsDto: {
    code: string;
  }[];
}

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}
export interface inputData {
  postingData: NetherlandsPostingInfo;
  postingState: localNeedsState;
  selectEmployeeIds: string[];
}
