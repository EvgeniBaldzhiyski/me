import moment from 'moment';
import { PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';
import { element as defaultElement } from '../utils/dom';
import { HungaryPostingInfo } from './interfaces';
import { COUNTRIES } from './maps';

function element<R extends HTMLInputElement | HTMLSelectElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

function addressToSet(data: PostingInfoAddress) {
  const { city, postcode, street, streetNumber } = data;
  return `${city}, ${street} ${streetNumber}, ${postcode}`;
}

function employeesToSet(employees: PostingInfoEmployee[]) {
  return employees.map(({fullName}, i) => `${i + 1}. ${fullName}`).join('\n');
}

export function fillServiceProviderStep(data: HungaryPostingInfo) {
  element('@cim').value = data.formIdentificationName;
  element('@szolg').value = data.postingCompanyName;
  element('@szolg_cim').value = addressToSet(data.postingCompanyAddress);
  element('@szolg_hely').value = COUNTRIES[data.postingCompanyAddress.country];
  element('@szolg_allamp').value = data.postingCompanyRegistrationNumber;
  element('@kep_cim').value = data.contactPerson.fullName;
  element('@kapcs_tel').value = data.postingCompanyAddress.telephone;
  element('@kapcs_email').value = data.postingCompanyAddress.email;
  element('@tevekenyseg').value = data.postingCompanyBusinessSector.description;
  element('#kijelent').click();
}

export function fillServiceProvisionStep(data: HungaryPostingInfo) {
  element('@munk_szam').value = data.employees.length as unknown as string;
  element('@munk_nev').value = employeesToSet(data.employees);
  const startDateObj = moment(data.startDate);
  const endDateObj = moment(data.endDate);
  const daysOfPosting = Math.round(endDateObj.diff(startDateObj, 'days'));
  element('@kikuld_ido').value = daysOfPosting as unknown as string;
  element('@kikuld_kezd').value = moment(data.startDate).format('DD-MM-YYYY');
  element('@kikuld_veg').value = moment(data.endDate).format('DD-MM-YYYY');
  element('@munk_hely').value = addressToSet(data.workplaceAddress);
  element('@kikuld_oka').value = data.natureOfTheService;
  element('@gdpr').click();
}
