import { TargetDataState } from '../../utils/comm.map';
import { PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}

export interface workplaceAddress {
  district: string;
  municipality: string;
  postcode: string;
  city: string;
  street: string;
  streetNumber: string;
}

export interface BulgariaPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumberType: string;
  identifyNumber: string;
  workplaceAddress: workplaceAddress;
}

export interface BulgariaPostingInfo extends PostingInfo {
  hostCompanyCorrAddress?: PostingInfoAddress;
  postCompanyCorrAddress?: PostingInfoAddress;
  employeeAdditionalInfo: BulgariaPostingAdditionalInfoEmployee[];
}
