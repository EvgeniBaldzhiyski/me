import { element as defaultElement, elements, selectValueByText } from '../utils/dom';
import { SECTORS, COUNTRIES, IDENTIFY_NUMBER_TYPE } from './maps';
import moment from 'moment';
import { mapDistrict, mapMunicipality } from './helpers';
import { setPostingState } from '../utils/simplify-api';
import { PostingInfoEmployee } from '../../utils/interfaces';
import { BulgariaPostingInfo, workplaceAddress } from './interfaces';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

export async function fillPostingPerson(info: BulgariaPostingInfo) {
  // Company
  element('@organisation_name').value = info.postingCompanyName;
  element('@organisation_id').value = info.postingCompanyRegistrationNumber;
  // eslint-disable-next-line max-len
  let inTheCapacityOf = '1. An enterprise that posts at its own expense under its own management, on the basis of a contract concluded between the employer and the service user';
  if (info.postCompanyIntragroup) {
    inTheCapacityOf =
      '2. An enterprise which posts to an undertaking in the same group of undertakings';
  }
  selectValueByText('@inq', inTheCapacityOf);
  const fullCode = info.postingCompanyBusinessSector.code;
  const codeArr = fullCode.split('.');
  const parentCode: string = codeArr[0];
  const foundDesct = SECTORS.find((item) => item.codes.includes(parentCode));
  selectValueByText('@activity_id', foundDesct?.description || '');

  // Company manager
  element('@last_name').value = info.representativePerson.lastName;
  element('@first_name').value = info.representativePerson.firstName;
  const birthDate = moment(info.representativePerson.dateOfBirth).format('DD/MM/YYYY');
  element('@director_birth_date').value = birthDate;
  element('@director_city').value = info.representativePerson.townOfBirth;
  selectValueByText('@director_country_id', COUNTRIES[info.representativePerson.countryOfBirth]);

  // Address
  selectValueByText('@country_id', COUNTRIES[info.postingCompanyAddress.country]);
  element('@post_code').value = info.postingCompanyAddress.postcode;
  element('@city').value = info.postingCompanyAddress.city;
  const addressStreet = info.postingCompanyAddress.street;
  const addressStreetNumber = info.postingCompanyAddress.streetNumber;
  const addressToSet = `${addressStreet} ${addressStreetNumber}`;
  element('@address').value = addressToSet;

  // Correspondence address
  if (info.postCompanyCorrAddress && info.postCompanyCorrAddress.country) {
    selectValueByText('@c_country_id', COUNTRIES[info.postCompanyCorrAddress.country]);
    element('@c_post_code').value = info.postCompanyCorrAddress.postcode;
    element('@c_city').value = info.postCompanyCorrAddress.city;
    const correspAddressStreet = info.postCompanyCorrAddress.street;
    const correspAddressStreetNumber = info.postCompanyCorrAddress.streetNumber;
    const correspAddresToSet = `${correspAddressStreet} ${correspAddressStreetNumber}`;
    element('@c_address').value = correspAddresToSet;
    element('@c_email').value = info.postCompanyCorrAddress.email;
    element('@c_phone').value = info.postCompanyCorrAddress.telephone;
  } else {
    selectValueByText('@c_country_id', COUNTRIES[info.postingCompanyAddress.country]);
    element('@c_post_code').value = info.postingCompanyAddress.postcode;
    element('@c_city').value = info.postingCompanyAddress.city;
    const correspAddressStreet = info.postingCompanyAddress.street;
    const correspAddressStreetNumber = info.postingCompanyAddress.streetNumber;
    const correspAddresToSet = `${correspAddressStreet} ${correspAddressStreetNumber}`;
    element('@c_address').value = correspAddresToSet;
    element('@c_email').value = info.postCompanyCorrAddress.email;
    element('@c_phone').value = info.postCompanyCorrAddress.telephone;
  }

  await setPostingState({ step: 1 });
  element('button.next-button').click();
}

export async function fillCustomerRecipient(info: BulgariaPostingInfo) {
  // Company
  element('@organisation_name').value = info.hostCompanyName;
  element('@organisation_id').value = info.hostCompanyRegistrationNumber;
  // Address
  element('@recipient_post_code').value = info.hostCompanyAddress.postcode;
  const districtToSet = mapDistrict(info.hostCompanyAddress.district);
  selectValueByText('@recipient_region', districtToSet);
  element('@recipient_region').dispatchEvent(new Event('change'));
  const municipalityToSet = mapMunicipality(info.hostCompanyAddress.municipality);
  selectValueByText('@recipient_municipality', municipalityToSet);
  element('@recipient_city').value = info.hostCompanyAddress.city;
  const addressStreet = info.hostCompanyAddress.street;
  const addressStreetNumber = info.hostCompanyAddress.streetNumber;
  const addressToSet = `${addressStreet} ${addressStreetNumber}`;
  element('@recipient_address').value = addressToSet;
  // Correspondence address
  if (info.hostCompanyCorrAddress && info.hostCompanyCorrAddress.city) {
    element('@recipient_c_post_code').value = info.hostCompanyCorrAddress.postcode;
    element('@recipient_c_city').value = info.hostCompanyCorrAddress.city;
    const correspAddressStreet = info.hostCompanyCorrAddress.street;
    const correspAddressStreetNumber = info.hostCompanyCorrAddress.streetNumber;
    const correspAddresToSet = `${correspAddressStreet} ${correspAddressStreetNumber}`;
    element('@recipient_c_address').value = correspAddresToSet;
    element('@recipient_c_email').value = info.hostCompanyCorrAddress.email;
    element('@recipient_c_phone').value = info.hostCompanyCorrAddress.telephone;
  } else {
    element('@recipient_c_post_code').value = info.hostCompanyAddress.postcode;
    element('@recipient_c_city').value = info.hostCompanyAddress.city;
    const correspAddressStreet = info.hostCompanyAddress.street;
    const correspAddressStreetNumber = info.hostCompanyAddress.streetNumber;
    const correspAddresToSet = `${correspAddressStreet} ${correspAddressStreetNumber}`;
    element('@recipient_c_address').value = correspAddresToSet;
    element('@recipient_c_email').value = info.hostCompanyCorrAddress.email;
    element('@recipient_c_phone').value = info.hostCompanyCorrAddress.telephone;
  }

  await setPostingState({ step: 2 });

  element('button.next-button').click();
}

export async function fillPlaceOfPosting(info: BulgariaPostingInfo) {
  const worksiteType = info.worksiteType;
  const workRadiosButtons = elements<HTMLInputElement>('input[name="work_place_radio"]');
  if (worksiteType) {
    workRadiosButtons[1].click();
    element('@worksite_name').value = info.worksiteType;
    const worksiteDistrict = info.worksiteAddress.addressDto.district;
    const addressRadiosButtons = elements<HTMLInputElement>('input[name="address_type_radio"]');
    if (worksiteDistrict) {
      addressRadiosButtons[0].click();
      const districtToSet = mapDistrict(info.worksiteAddress.addressDto.district);
      selectValueByText('@worksite_region', districtToSet);
      element('@worksite_region').dispatchEvent(new Event('change'));
      const municipalityToSet = mapMunicipality(info.worksiteAddress.addressDto.municipality);
      selectValueByText('@worksite_municipality', municipalityToSet);
      const worksiteAddressStreet = info.worksiteAddress.addressDto.street;
      const worksiteAddressStreetNumber = info.worksiteAddress.addressDto.streetNumber;
      const worksiteAddressToSet = `${worksiteAddressStreet} ${worksiteAddressStreetNumber}`;
      element('@worksite_address').value = worksiteAddressToSet;
      element('@worksite_post_code').value = info.worksiteAddress.addressDto.postcode;
      element('@worksite_city').value = info.worksiteAddress.addressDto.city;

      await setPostingState({ step: 3 });

      element('button.next-button').click();
    } else {
      addressRadiosButtons[1].click();
      element('@worksite_post_code').value = info.worksiteAddress.addressDto.postcode;
      element('@worksite_city').value = info.worksiteAddress.addressDto.city;

      await setPostingState({ step: 3 });

      element('button.next-button').click();
    }
  } else {
    workRadiosButtons[0].click();

    await setPostingState({ step: 3 });

    element('button.next-button').click();
  }
}
function prepareSelectedEmployee( employees: PostingInfoEmployee[], getSelectedEmployeeIds: string[]): PostingInfoEmployee[] {
  const filteredEmployees: PostingInfoEmployee[] = [];
  const setOfSelectedEmployees = new Set(getSelectedEmployeeIds);

  for (const employee of employees) {
    if (setOfSelectedEmployees.has(employee.id)) {
      filteredEmployees.push(employee);
    }
  }

  return filteredEmployees;
}

export async function addAllEmployees( info: BulgariaPostingInfo, employeeIndex: number, getSelectedEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(info.employees, getSelectedEmployeeIds);

  const employee = employees[employeeIndex];

  if (employee) {
    await setPostingState({ step: 4, employeeIndex });

    element('a.next-button.row').click();
  } else {
    await setPostingState({ step: 5 });

    element('i.la.la-arrow-alt-circle-right').click();
  }
}

export async function fillEmployeeData(info: BulgariaPostingInfo, employeeIndex: number, getSelectedEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(info.employees, getSelectedEmployeeIds);

  const employee = employees[employeeIndex];
  const gender = employee.gender as unknown as string;
  const genderRadiosButtons = elements<HTMLInputElement>('input[name="gender_radio"]');
  if (gender === '1') {
    genderRadiosButtons[0].click();
  } else {
    genderRadiosButtons[1].click();
  }
  element('@last_name').value = employee.lastName;
  element('@first_name').value = employee.firstName;
  const birthDate = moment(employee.dateOfBirth).format('DD/MM/YYYY');
  element('@birth_date').value = birthDate;
  element('@birth_city').value = employee.townOfBirth;
  selectValueByText('@birth_country_id', COUNTRIES[employee.countryOfBirth]);
  selectValueByText('@nationality_country_id', COUNTRIES[employee.nationality]);
  // Address
  selectValueByText('@address_country_id', COUNTRIES[employee.address.country]);
  element('@address_post_code').value = employee.address.postcode;
  element('@address_city').value = employee.address.city;
  const employeeAddressStreet = employee.address.street;
  const employeeAddressStreetNumber = employee.address.streetNumber;
  const employeeAddressToSet = `${employeeAddressStreet} ${employeeAddressStreetNumber}`;
  element('@address').value = employeeAddressToSet;
  // Period Of Posting
  element('@posting_start_date').value = moment(info.startDate).format('DD/MM/YYYY');
  element('@posting_estimated_end_date').value = moment(info.endDate).format('DD/MM/YYYY');
  const fullCode = info.postingCompanyBusinessSector.code;
  const codeArr = fullCode.split('.');
  const parentCode: string = codeArr[0];
  const foundDesct = SECTORS.find((item) => item.codes.includes(parentCode));
  selectValueByText('@activity_id', foundDesct?.description || '');

  for (const _employee of info.employeeAdditionalInfo) {
    if (_employee.employeeId === employee.id) {
      selectValueByText(
        '@personal_id_type',
        IDENTIFY_NUMBER_TYPE[_employee.identifyNumberType as string]
      );
      element('@personal_id').value = _employee.identifyNumber;

      const address: workplaceAddress = _employee.workplaceAddress;

      // Employee Work Address
      selectValueByText('@post_region', mapDistrict(address.district));

      element('@post_region').dispatchEvent(new Event('change'));

      selectValueByText('@post_municipality', mapMunicipality(address.municipality));

      element('@post_post_code').value = address.postcode;
      element('@post_city').value = address.city;

      element('@post_address').value = `${address.street} ${address.streetNumber}`;
      break;
    }
  }

  await setPostingState({ step: 3, employeeIndex: employeeIndex + 1 });

  element('button.next-button').click();
}

export async function fillPersonOfLiase(info: BulgariaPostingInfo) {
  const documentPersonRole: string = info.documentPersonRole.toLowerCase();
  for (const el of elements<HTMLInputElement>('input[ type="radio"]')) {
    if (el.parentElement?.innerHTML.toLowerCase().includes(documentPersonRole)) {
      el.click();
      break;
    }
  }
  element('@representative_last_name').value = info.documentPerson.lastName;
  element('@representative_first_name').value = info.documentPerson.firstName;
  element('@representative_email').value = info.documentPerson.email;
  element('@representative_phone').value = info.documentPerson.telephoneNumber;
  element('@contact_post_code').value = info.documentPerson.address.postcode;
  element('@contact_city').value = info.documentPerson.address.city;
  const documentPersonAddressStreet = info.documentPerson.address.street;
  const documentPersonAddressStreetNumber = info.documentPerson.address.streetNumber;
  const documentPersonAddressToSet = `${documentPersonAddressStreet} ${documentPersonAddressStreetNumber}`;
  element('@contact_address').value = documentPersonAddressToSet;

  await setPostingState({ step: 6 });

  element('button.next-button').click();
}

export async function fillContactPerson(info: BulgariaPostingInfo) {
  element('@contact_ln').value = info.contactPerson.lastName;
  element('@contact_fn').value = info.contactPerson.firstName;
  element('@contact_email').value = info.contactPerson.email;
  element('@contact_phone').value = info.contactPerson.telephoneNumber;

  await setPostingState({ step: 7 });

  element('button.next-button').click();
}
