import { TargetDataState } from '../../utils/comm.map';
import { BusinessSector, PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}

export type timestamp = number;

export interface SlovenianPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  addressInSlovenia: PostingInfoAddress;
  startDate: timestamp;
  endDate: timestamp;
}

export interface SlovenianPostingInfo extends PostingInfo {
  employeeAdditionalInfo: SlovenianPostingAdditionalInfoEmployee[];
  professionalRepresentativeMobileNumber?: string;
  contactPersonMobileNumber?: string;
  postCompanyBusinessSectorsDto: BusinessSector[];
  workplaceAddress: PostingInfoAddress;
}
