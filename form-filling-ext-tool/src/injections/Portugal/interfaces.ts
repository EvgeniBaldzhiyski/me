import { TargetDataState } from '../../utils/comm.map';
import { PostingAdditionalInfoEmployee, PostingInfo } from '../../utils/interfaces';

interface workPlaceAddress {
  district: string;
  municipality: string;
  postcode: string;
  city: string;
  street: string;
  streetNumber: string;
}

export interface PortugalPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumberType: string;
  identifyNumber: string;
  professionalCategory: string;
  workPlaceAddress: workPlaceAddress;
}

export interface PortugalPostingInfo extends PostingInfo {
  employeeAdditionalInfo: PortugalPostingAdditionalInfoEmployee[];
  hostCompanySocialSecurityNumber: string;
}

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}
