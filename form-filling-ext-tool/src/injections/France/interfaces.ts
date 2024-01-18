import { PostingAdditionalInfoEmployee, PostingInfo, PostingInfoAddress, PostingInfoEmployee, timestamp } from '../../utils/interfaces';

export interface FrancePostingAdditionalInfoEmployee extends PostingAdditionalInfoEmployee {
  reasonForLongTermPosting: string;
  positionHeldInFrance: string;
  professionalQualification: string;
  grossHourlyRateOfPay: number;
  countryOfLegislation: number;
}

export type WorkSiteType = 'CUSTOMER_WORK_SITE' | 'DIFFERENT_WORK_SITE' | 'TEMPORARY_WORK_SITE';

export interface FrancePostingInfoAddress extends PostingInfoAddress {
  siretNumber: string;
}

export interface FrancePostingInfo extends PostingInfo {
  employeeAdditionalInfo: FrancePostingAdditionalInfoEmployee[];

  workSiteId: string;
  workSiteType: WorkSiteType;
  workSiteName: string;
  colleciveAccommodationName: string;

  workSiteAddress: FrancePostingInfoAddress;
  colleciveAccommodationAddress: PostingInfoAddress;

  serviceInfoAndCostsId: number;
  hazardousEquipment: string;
  workStartTime: timestamp;
  workEndTime: timestamp;
  restDaysPerWeek: timestamp;

  representativePerson: PostingInfoEmployee;

  hostCompanyBusinessSectorId: number;

  locationOfTheStoredDocuments: string;

  serviceRelatedToMinistryOfDefense: boolean;
  serviceRelatedToParisExpress: boolean;
  serviceRelatedToOlympicGames: boolean;
  hostCompanySirenNumber: string;
  financialGuaranteeBody: string;
}

export interface AddressValues {
  street: string;
  streetNumber: number;
  latitude: number;
  longitude: number;
}

export interface BusinessSectors {
  id: number;
  tooltip: string;
  children: BusinessSectors;
}
