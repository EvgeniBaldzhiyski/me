import { PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress, timestamp } from '../../utils/interfaces';


export interface DenmarkPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumberType: string;
  identifyNumber: string;
  a1CertificateId: number;
  a1ApplicationDocumentId: number;
  declarationOfQualificationId: number;
}

export interface DenmarkPostingInfo extends PostingInfo {
  employeeAdditionalInfo: DenmarkPostingAdditionalInfoEmployee[];
  hostCompanySocialSecurityNumber: string;
  workplaceName: string;
  workplaceAddress: PostingInfoAddress;
  workplaceAddressFloor: string;
  workplaceAddressDoor: string;
  projectStartDate: timestamp;
  projectEndDate: timestamp;
  postCompanyContactPersonId: string;
}
