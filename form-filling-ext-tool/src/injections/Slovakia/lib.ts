import moment from 'moment';
import { element as defaultElement, selectValueByText } from '../utils/dom';
import { SlovakiaPostingAdditionalInfoEmployee, SlovakiaPostingInfo, workingAddress } from './interfaces';
import { COUNTRIES } from './maps';
import { PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement | HTMLSelectElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

function getAddress(address: string): workingAddress {
  const [city, street, streetNumber] = address.split('_');
  return {city, street, streetNumber};
}

function fillSelectField(id: string, value: string, mode: 'regex' | 'strictMatch' | 'include' = 'strictMatch'): void {
  selectValueByText(id, value, mode);
  const el = element(id);
  el.dispatchEvent( new Event('change'));
}

export function fillHostCompanyForm(data: SlovakiaPostingInfo){
  element('#employer-company').value = data.hostCompanyName;
  element('#employer-address_city').value = data.hostCompanyAddress.city;
  element('#employer-address_street').value = data.hostCompanyAddress.street;
  element('#employer-address_number').value = data.hostCompanyAddress.streetNumber.toString();
  element('#employer-address_psc').value = data.hostCompanyAddress.postcode;
  fillSelectField('#employer-country_id',  COUNTRIES[data.hostCompanyAddress.country]);
  fillSelectField('#emp-iType-id', 'Other registration number');
  element('#employer-ico').value = data.hostCompanyRegistrationNumber;
  element('#employer-register').value = 'Slovakia';
}

export function fillPostingForm(data: SlovakiaPostingInfo, countEmployee: number){
  const workingAddress = getAddress(data.workingAddress);
  element('#posting-from_date').value =  moment(data.startDate).format('DD.MM.YYYY');
  element('#posting-to_date').value =  moment(data.endDate).format('DD.MM.YYYY');
  fillSelectField('#place-id', workingAddress.city, 'include');
  element('#posting-description').value = `${workingAddress.street}, ${workingAddress.streetNumber}`;
  element('#posting-additional').value = data.additionalWorkingAddress;
  element('#posting-numofemployees').value = countEmployee.toString();
  fillSelectField('#cat-id', data.postingCompanyBusinessSector.description, 'include');
}

export function fillContactPersonForm(data: SlovakiaPostingInfo){
  element('#contactperson-first_name').value = data.contactPerson.firstName;
  element('#contactperson-surname').value = data.contactPerson.lastName;
  element('#contactperson-address_city').value = data.contactPerson.address.city;
  element('#contactperson-address_street').value = data.contactPerson.address.street;
  element('#contactperson-address_number').value = data.contactPerson.address.streetNumber.toString();
  element('#contactperson-address_psc').value = data.contactPerson.address.postcode;
  element('#contactperson-email').value = data.contactPerson.email;
}

export function fillEmployeesForm(data: SlovakiaPostingInfo, employee: PostingInfoEmployee & SlovakiaPostingAdditionalInfoEmployee){
  const workingAddress = getAddress(data.workingAddress);
  const duration = moment(data.endDate).diff(moment(data.startDate), 'months');
  console.log('duration', duration);

  element('#employee-first_name').value = employee.firstName;
  element('#employee-surname').value = employee.lastName;
  element('#employee-address_city').value = employee.address.city;
  element('#employee-address_street').value = employee.address.street;
  element('#employee-address_number').value = employee.address.streetNumber.toString();
  element('#employee-address_psc').value = employee.address.postcode;
  fillSelectField('#employee-country_id',  COUNTRIES[employee.address.country]);
  element('#employee-identity_document_number').value = employee.identityDocumentNumber;
  element('#employee-birth_date').value =  moment(employee.dateOfBirth).format('DD.MM.YYYY');
  fillSelectField('#employee-nationality_id',  COUNTRIES[employee.address.country]);
  element('#employee-type_of_work').value = employee.taskToPerform;
  fillSelectField('#place_of_work_id_employee', workingAddress.city, 'include');
  element('#durationposting-start_posting_employee').value =  moment(data.startDate).format('DD.MM.YYYY');
  element('#durationposting-finish_posting_employee').value = moment(data.endDate).format('DD.MM.YYYY');

  if(duration > 18){
    element('#durationposting-duration_posting_more_18').click();
  }else if(duration >= 12 && duration <= 18){
    element('#durationposting-duration_posting_12_18').click();
    element('#durationposting-reason_duration_12').value = employee.reasonForLongTermPosting;
    element('#durationposting-reason_duration_12').value = 'TO Do';
  }

  if(employee.replacedWorker){
    element('#postingform-replacement').click();
    element('#employee-tmp_replacement-first_name').value = employee.replacedWorker.firstName;
    element('#employee-tmp_replacement-surname').value = employee.replacedWorker.lastName;
    element('#employee-tmp_replacement-address_city').value = employee.replacedWorker.address.city;
    element('#employee-tmp_replacement-address_street').value = employee.replacedWorker.address.street;
    element('#employee-tmp_replacement-address_number').value = employee.replacedWorker.address.streetNumber.toString();
    element('#employee-tmp_replacement-address_psc').value = employee.replacedWorker.address.postcode;
    fillSelectField('#employee-tmp_replacement-country_id',  COUNTRIES[employee.replacedWorker.address.country]);
    element('#employee-tmp_replacement-birth_date').value =  moment(employee.replacedWorker.dateOfBirth).format('DD.MM.YYYY');
    fillSelectField('#nationality-tmp_replacement',  COUNTRIES[employee.replacedWorker.nationality]);
    element('#employee-tmp_replacement-type_of_work').value = employee.replacedWorker.taskToPerform;
  }

  element('#posting-new-employee-button').click();
}
export function statementOfHostEmployer() {
  element('#conditions_create_posting').click();
  // element('button.submit-btn-protect').click();
}
