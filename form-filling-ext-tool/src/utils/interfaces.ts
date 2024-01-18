export interface loginCredentials {
  name: string;
  pass: string;
}

export type timestamp = number;

export interface PostingEmployee {
  address?: string;
  contractDate?: timestamp;
  countryOfBirth?: string;
  countryOfLegislation: string;
  dateOfBirth: timestamp;
  documentStorageType?: string;
  email?: string;
  employeeType?: string;
  firstName: string;
  gender: string;
  hourlyRate: number;
  id: string;
  ismId: string;
  lastName: string;
  nationality: number;
  organizationId: number;
  organizationName: string;
  postingWorkPosition: string;
  professionalQualification: string;
  reasonForLongTermPosting: string;
  telephoneNumber: string;
  townOfBirth: string;
}

export interface PostingInfoAddress {
  city: string;
  country: string;
  district?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  postcode: string;
  street?: string;
  streetNumber?: number;
  siretNumber: string;
  telephone: string;
  fax?: string;
  box?: string;
  municipality?: string;
}

export interface PostingItem {
  employees: PostingEmployee[];
  endDate: timestamp;
  hostCompanyAddress: PostingInfoAddress;
  hostStateCountryBusinessSectorDescription: string;
  hostCompanyDistrictName: string;
  hostingCountryName: string;
  ismId: string;
  postingCompanyName: string;
  postingCountryName: string;
  startDate: timestamp;
}

export enum EmployeeType {
  DOCUMENT_PERSON = 'DOCUMENT_PERSON',
  CONTACT_PERSON = 'CONTACT_PERSON',
  CONTACT_PERSON_SECONDED = 'CONTACT_PERSON_SECONDED',
  RECIPIENT_PERSON = 'RECIPIENT_PERSON',
  EMPLOYEE_REPRESENTATIVE = 'EMPLOYEE_REPRESENTATIVE',
  DIRECTOR_REPRESENTATIVE = 'DIRECTOR_REPRESENTATIVE',
  CUSTOMER_REPRESENTATIVE = 'CUSTOMER_REPRESENTATIVE',
  PROFESSIONAL_REPRESENTATIVE = 'PROFESIONAL_REPRESENTATIVE',
}

export interface Classification {
  id: string;
  depth: number;
  ltf: number;
  name: string;
  tooltip: string;
}

export interface PostingInfoEmployee {
  // @todo wrong type - have to be number instead
  id: string;
  employeeType: EmployeeType;
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: timestamp;
  gender: number;
  nationality: string;
  address: PostingInfoAddress;
  professionalQualification: string;
  organizationName: string;
  townOfBirth?: string;
  countryOfBirth?: string;
  email?: string;
  telephoneNumber?: string;
  label: string;
  description: string;
  pin?: string;
  job?: string;
  classification: Classification;
  position: string;
  taskToPerform: string;
}

export interface PostingAdditionalInfoEmployee {
  id: string;
  employeeId: PostingEmployee['id'];
}

export interface BusinessSector {
  id: number;
  description: string;
  country: {
    id: number;
    name: string;
  };
  code?: string;
}

export interface StateCountry {
  id: number;
  name: string;
}

export interface WorksiteAddress {
  addressDto: PostingInfoAddress;
}

export interface PostingInfo {
  ismId: string;

  employees: PostingInfoEmployee[];
  employeeAdditionalInfo: PostingAdditionalInfoEmployee[];

  // SPECIAL EMPLOYEES
  contactPerson: PostingInfoEmployee;
  documentPerson?: PostingInfoEmployee;
  reporterPerson?: PostingInfoEmployee;
  recipientPerson?: PostingInfoEmployee;
  representativePerson?: PostingInfoEmployee;

  documentPersonRole?: string;

  // HOST
  hostCompanyAddress: PostingInfoAddress;
  hostCompanyName: string;
  hostStateCountryBusinessSector: BusinessSector;
  hostStateCountry: StateCountry;
  hostCompanyVatNumber: string;
  // @todo check if this is available for all contries
  hostCompanyCBENumber?: string;
  // @todo check if this is available for all contries
  hostCompanyNOSSNumber?: string;
  hostCompanyRegistrationNumber?: string;
  hostCompanyBusinessSector?: BusinessSector;

  postingCompanyAddress?: PostingInfoAddress;
  postingCompanyName?: string;
  postingCompanyBusinessSector?: BusinessSector;
  postingStateCountry?: StateCountry;
  postingCompanyVatNumber: string;
  postingCompanyRegistrationNumber?: string;

  // @todo check if this is available for all contries
  vatMissingExplanation?: string;
  // @todo check if this is available for all contries
  workStartTimeBeforeBreak?: string;
  // @todo check if this is available for all contries
  workEndTimeBeforeBreak?: string;
  // @todo check if this is available for all contries
  workStartTimeAfterBreak?: string;
  // @todo check if this is available for all contries
  workEndTimeAfterBreak?: string;
  // @todo check if this is available for all contries
  fromDayWeek?: string;
  // @todo check if this is available for all contries
  toDayWeek?: string;
  // @todo check if this is available for all contries
  exceptDayWeek?: string;
  // @todo check if this is available for all contries
  emailContact?: string;
  // @todo check if this is available for all contries
  postCompanyIntragroup?: string;

  // DATES
  startDate: timestamp;
  endDate: timestamp;

  worksiteAddress?: WorksiteAddress;
  performedWorkAddress?: WorksiteAddress;
  worksiteType?: string;
}

export interface GetFileOptions {
  method: 'get' | 'post' | 'put';
  url: string;
  data?: object;
}
