import { TargetDataState } from '../../utils/comm.map';
import { PostingAdditionalInfoEmployee, PostingInfo } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
  phase?: number;
}

export interface PortugalPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumberType: string;
  identifyNumber: string;
  identificationCountry: string;
}

export interface PortugalPostingInfo extends PostingInfo {
  employeeAdditionalInfo: PortugalPostingAdditionalInfoEmployee[];
}
