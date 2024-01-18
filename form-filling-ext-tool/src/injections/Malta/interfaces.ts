import { PostingAdditionalInfoEmployee, PostingInfo, timestamp } from '../../utils/interfaces';

export type IdentifyNumberType = 'NATIONAL_NUMBER' | 'PASSPORT_NUMBER' | 'SOCIAL_SECURITY_NUMBER' | 'PENSION_NUMBER' | 'OTHER_DOCUMENT';
export type TypeOfContract = 'Indefinite' | 'Definite' | 'Other';

export interface MaltaPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  identifyNumberType: IdentifyNumberType;
  identifyNumber: string;
  identifyCountryOfIssue: string;
  identifyExpiryDate: number;
  employmentDate: timestamp;
  typeOfContract: TypeOfContract;
  typeOfContractSpecificity: string;
  hourlyRateOfPay: number;
  hoursOfWorkDuringPosting: number;
  overtimeRateOfPay: number;
  wagePaymentPeriod: string;
  postingAllowancesAmount: number;
  expensesCoveredByPostingCompany: boolean;
  contractOfEmploymentId: string;
  identificationDocumentId: string;
  postingSpecificDocumentsId: string;
}

export interface MaltaPostingInfo extends PostingInfo {
  natureOfPosting: 0 | 1| 2;
  typeOfWork: string;
  subcontractorName: string;
  employeeAdditionalInfo: MaltaPostingAdditionalInfoEmployee[];
}
