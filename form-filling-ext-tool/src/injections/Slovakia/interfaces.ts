import {
  PostingAdditionalInfoEmployee,
  PostingInfo,
  PostingInfoAddress,
  PostingInfoEmployee
} from '../../utils/interfaces';

export interface SlovakiaPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  workingAddress: string;
  replacedWorker: PostingInfoEmployee;
  identityDocumentNumber: string;
  taskToPerform: string;
  reasonForLongTermPosting: string;
}

export interface SlovakiaPostingInfo extends PostingInfo{
  additionalWorkingAddress: string;
  workingAddress: string;
  workplaceAddress: PostingInfoAddress;
  employeeAdditionalInfo: SlovakiaPostingAdditionalInfoEmployee[];
}
export interface workingAddress {
  city: string;
  street: string;
  streetNumber: string;
}
