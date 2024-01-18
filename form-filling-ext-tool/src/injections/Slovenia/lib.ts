import moment from 'moment';
import { element as defaultElement, elements, onMutation } from '../utils/dom';
import { SlovenianPostingAdditionalInfoEmployee, SlovenianPostingInfo } from './interfaces';
import { COUNTRIES } from './maps';
import { PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

function prepareSelectedEmployee(employees: PostingInfoEmployee[], getSelectedEmployeeIds: string[]): PostingInfoEmployee[] {
  const filteredEmployees: PostingInfoEmployee[] = [];
  const setOfSelectedEmployees = new Set(getSelectedEmployeeIds);

  for (const employee of employees) {
    if (setOfSelectedEmployees.has(employee.id)) {
      filteredEmployees.push(employee);
    }
  }
  return filteredEmployees;
}

function fillFormInput(fieldSelector: string, value: string) {
  const el = element(fieldSelector);

  el.value = value;

  el.dispatchEvent(new Event('input'));
  el.dispatchEvent(new Event('blur'));
}

async function fillSearchFormInput(fieldSelector: string, value: string) {
  let el;
  for (const domEl of elements<HTMLInputElement>(fieldSelector)) {
    if (!domEl.value) {
      el = domEl;
      break;
    }
  }

  el.value = value;

  el.dispatchEvent(new Event('input'));
  await onMutation(document.body, () => !!element('mdb-option', true));

  element('mdb-option').click();
  el.dispatchEvent(new Event('blur'));
  if (element('mdb-option', true)) {
    await onMutation(document.body, () => !element('mdb-option', true));
  }
}

export async function fillEmployerStep(data: SlovenianPostingInfo) {
  fillFormInput('#searchText2', data.postingCompanyName);
  fillFormInput('#street6', data.postingCompanyAddress.street);
  fillFormInput('#streentNumber6', data.postingCompanyAddress.streetNumber as unknown as string);
  fillFormInput('#citiy6', data.postingCompanyAddress.city);
  fillFormInput('#postNumber6', data.postingCompanyAddress.postcode);
  await fillSearchFormInput('#countrySearch2', COUNTRIES[data.postingCompanyAddress.country]);
  fillFormInput('#taxNumber6', data.postingCompanyRegistrationNumber);
}

export async function fillResponsibleOfficerStep(data: SlovenianPostingInfo) {
  fillFormInput('#nameLastName9', data.representativePerson.fullName);
  fillFormInput('#birthDate9', moment(data.representativePerson.dateOfBirth).format('DD. MM. YYYY'));
  await fillSearchFormInput('#citizenshipSearch', COUNTRIES[data.representativePerson.nationality]);
  fillFormInput('#phone9', data.representativePerson.address.telephone);
  fillFormInput('#mobi9', `${data.professionalRepresentativeMobileNumber}`);
  fillFormInput('#eMail9', data.representativePerson.address.email);
}

export async function fillServiceStep(data: SlovenianPostingInfo) {
  await fillSearchFormInput('#serviceSearch', data.postCompanyBusinessSectorsDto[0].description);
  fillFormInput('#Description', data.postCompanyBusinessSectorsDto[0].description);
}

export async function fillLocationStep(data: SlovenianPostingInfo) {
  fillFormInput('#1street', data.workplaceAddress.street);
  fillFormInput('#1streetNumber', data.workplaceAddress.streetNumber as unknown as string);
  await fillSearchFormInput('#postSearch', data.workplaceAddress.postcode);
}

export function fillDurationStep(data: SlovenianPostingInfo) {
  fillFormInput('#dateFrom', moment(data.startDate).format('DD. MM. YYYY'));
  fillFormInput('#dateTo', moment(data.endDate).format('DD. MM. YYYY'));
}

export async function fillOrderingStep(data: SlovenianPostingInfo) {
  element('#tipNarocnika1').click();
  await fillSearchFormInput('#autocomplete', data.hostCompanyRegistrationNumber);
}

async function fillEmployee(employee: PostingInfoEmployee, additionInfo: SlovenianPostingAdditionalInfoEmployee) {
  fillFormInput('#name7', employee.firstName);
  fillFormInput('#lastName7', employee.lastName);
  fillFormInput('#birthDate', moment(employee.dateOfBirth).format('DD. MM. YYYY'));
  await fillSearchFormInput('#citizenshipSearch', COUNTRIES[employee.nationality]);
  fillFormInput('#street7', additionInfo.addressInSlovenia.street);
  fillFormInput('#streetNumber7', `${additionInfo.addressInSlovenia.streetNumber}`);
  await fillSearchFormInput('#postSearch', `${additionInfo.addressInSlovenia.postcode}`);
  fillFormInput('#dateFromWorker', moment(additionInfo.startDate).format('DD. MM. YYYY'));
  fillFormInput('#dateToWorker', moment(additionInfo.endDate).format('DD. MM. YYYY'));
  element('#flexCheckDefault').click();
  elements('button.btn.btn-primary')[4].click();
}

export async function fillPostedWorkersStep(data: SlovenianPostingInfo, selectEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);

  const employeeAdditionalInfo: Map<string, SlovenianPostingAdditionalInfoEmployee> = new Map();

  for (const additionalInfo of data.employeeAdditionalInfo) {
    employeeAdditionalInfo.set(additionalInfo.employeeId, additionalInfo);
  }

  for (const employee of employees) {
    elements('button.btn.btn-primary')[1].click();
    await fillEmployee(employee, employeeAdditionalInfo.get(employee.id));
    await new Promise((resolve) => {
      setTimeout(() => resolve(1), 2000);
    });
  }
}

export async function fillContactPersonStep(data: SlovenianPostingInfo) {
  element('#flexRadioDefault2').click();
  fillFormInput('#name8', data.contactPerson.firstName);
  fillFormInput('#lastName8', data.contactPerson.lastName);
  fillFormInput('#birthDate8', moment(data.contactPerson.dateOfBirth).format('DD. MM. YYYY'));
  await fillSearchFormInput('#autocomplete', COUNTRIES[data.contactPerson.nationality]);
  fillFormInput('#phone8', data.contactPerson.address.telephone);
  fillFormInput('#mobi8', `${data.contactPersonMobileNumber}`);
  fillFormInput('#eMail8', data.contactPerson.address.email);
  elements('button.btn.btn-primary')[2].click();
}
