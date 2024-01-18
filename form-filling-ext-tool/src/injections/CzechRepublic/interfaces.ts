import {PostingAdditionalInfoEmployee, PostingInfo} from '../../utils/interfaces';

interface WorkPlaceAddress {
  city: string;
  municipality: string;
  postcode: string;
  street: string;
  streetNumber: string;
}
export interface CzechPostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee{
  fromEU: boolean;
  identifyNumber: string;
  comment: string;
}
export interface CzechPostingInfo extends PostingInfo {
  hostCompanyConscriptionNumber: string;
  hostCompanyOrientationNumber: string;
  workPlaceAddress: WorkPlaceAddress;
  workPlaceConscriptionNumber: string;
  workPlaceOrientationNumber: string;
  workPlaceAddressFreeText: string;
  typeOfWork: string;
  dateOfIssue: string;
  hostPersonBirthCertificateNumber: string;
  employeeAdditionalInfo: CzechPostingAdditionalInfoEmployee[];
}
