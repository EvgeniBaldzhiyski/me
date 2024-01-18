import { TargetDataState } from '../../utils/comm.map';
import {
  BusinessSector, PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress, PostingInfoEmployee
} from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  employeeIndex?: number;
}

export interface FinlandPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  taxIdentificationNumber?: string;
  finishTaxNumber: string;
}

export interface FinlandPostingInfo extends PostingInfo {
  employeeAdditionalInfo: FinlandPostingAdditionalInfoEmployee[];
  postCompanyBusinessId?: string;
  licensePlateVehicle?: string;
  directorRepresentative: PostingInfoEmployee;
  customerRepresentative: PostingInfoEmployee;
  hostCompanyBusinessId?: string;
  workDoneInConstructionSector: boolean;
  builderName?: string;
  builderBusinessId?: string;
  builderRegistrationNumber?: string;
  builderAddress: PostingInfoAddress;
  mainContractorName?: string;
  mainContractorBusinessId?: string;
  mainContractorRegistrationNumber?: string;
  mainContractorAddress: PostingInfoAddress;
  workPlaceAddress: PostingInfoAddress;
  additionalInformation?: string;
  postCompanyBusinessSectorsDto: BusinessSector[];
}
