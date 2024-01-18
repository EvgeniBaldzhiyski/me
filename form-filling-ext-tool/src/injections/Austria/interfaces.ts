import { TargetDataState } from '../../utils/comm.map';
import { PostingInfo, PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';

export interface localNeedsState extends TargetDataState {
  location?: number;
  employeeIndex?: number;
}

export interface AustrianWorkSite {
  workSiteId: string;
  address: PostingInfoAddress;
}

export enum StoryTypes {
  HOST_COMPANY = 'HOST_COMPANY',
  CONTACT_PERSON = 'CONTACT_PERSON',
  REPRESENTATIVE_ADDRESS = 'REPRESENTATIVE_ADDRESS',
  ONSITE = 'ONSITE',
  STORAGE_PLACE = 'STORAGE_PLACE',
}

export enum HostCompanyType {
  HOST_COMPANY = 'HOST_COMPANY',
  PRIVATE_PERSON = 'PRIVATE_PERSON',
}

export class PayAmountType {
  DAY = '3';
  WEEK = '2';
  MONTH = '1';
  HOURS = '4';
}

export interface PostingInfoEmployeeAustriaSpecificData {
  socialSecurityNumber: string;
  socialInsuranceAgency: string;
  typeOfWorkAndDeployment: string;
  workingStartTime: string;
  workingEndTime: string;
  workingHours: string;
  payAmount: string;
  payAmountType: keyof PayAmountType;
  startOfEmployment: number;
  miscellaneous: string;
  notes: string;
  eaIssuingAuthority: string;
  eaDateOfIssue: number;
  eaResidencePermit: boolean;
  eaFileNumber: string;
  eaValidityPeriod: string;
  rpIssuingAuthority: string;
  rpDateOfIssue: number;
  rpEmploymentAuthorization: boolean;
  rpFileNumber: string;
  rpValidityPeriod: string;
  constructionWork: boolean;
}

export interface PostingInfoEmployeeAustria extends PostingInfoEmployee {
  notificationPluginEmployeeAustriaDto: PostingInfoEmployeeAustriaSpecificData;
}

export interface AustriaPostingInfo extends PostingInfo {
  workSites: AustrianWorkSite[];
  documentPerson: PostingInfoEmployee & {
    documentStorageType: StoryTypes;
  };
  hostCompanyType: HostCompanyType;
  employees: PostingInfoEmployeeAustria[];
}
