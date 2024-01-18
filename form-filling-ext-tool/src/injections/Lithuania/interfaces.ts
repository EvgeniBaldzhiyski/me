import { PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress } from '../../utils/interfaces';

export interface LithuaniaPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumber: string;
  identifyNumberType: string;
  identifyNumberTypeExpDate: number;
  replacedWorkerFullName: string;
  countryOfSocialInsurance: string;
  socialSecurityCertificate: string;

}

export interface LithuaniaPostingInfo extends PostingInfo{
  basisOfSecondment: string;
  workplaceAddress: PostingInfoAddress;
  documentStorageAddress: PostingInfoAddress;
  employeeAdditionalInfo: LithuaniaPostingAdditionalInfoEmployee[];
}
