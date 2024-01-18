import moment from 'moment';
import { element as defaultElement, elements, onMutation, selectValueByTextByNode, sleep } from '../utils/dom';
import {
  COUNTRIES,
  EmployeeFormDateBoxNames,
  EmployeeFormDropdownNames,
  FormButtonNames,
  FormDateBoxNames,
  FormFieldNames,
  FormPostalCodeFieldNames,
} from './maps';
import { PostingInfoEmployee } from '../../utils/interfaces';
import { SwitzerlandPostingAdditionalInfoEmployee, SwitzerlandPostingInfo } from './interfaces';

function element<R extends HTMLInputElement | HTMLSelectElement>(
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

let cache: {
  formFieldList?: HTMLInputElement[];
  formPostalCodeFields?: HTMLInputElement[];
  formDateFields?: HTMLInputElement[];
  buttons?: HTMLElement[];
  formSelectFields?: HTMLSelectElement[];
} = { };

function getFormFields(): HTMLInputElement[] {
  if (!cache.formFieldList) {
    cache.formFieldList = elements<HTMLInputElement>('input.gwt-TextBox.iwt-Content');
  }
  return cache.formFieldList;
}

function fillFormField(name: FormFieldNames, value: string | number): void {
  getFormFields()[name].value = `${value}`;
}


function getFormPostalCodeFields(): HTMLInputElement[] {
  if (!cache.formPostalCodeFields) {
    cache.formPostalCodeFields = elements<HTMLInputElement>('input.gwt-SuggestBox.iwt-Content');
  }
  return cache.formPostalCodeFields;
}

function fillFormPostalCodeField(name: FormPostalCodeFieldNames, value: string | number): void {
  getFormPostalCodeFields()[name].value = `${value}`;
}

function getFormDateFields(): HTMLInputElement[] {
  if (!cache.formDateFields) {
    cache.formDateFields = elements<HTMLInputElement>('input.gwt-DateBox.iwt-Content');
  }
  return cache.formDateFields;
}

function fillFormDateField(name: FormDateBoxNames, value: string | number): void {
  getFormDateFields()[name].value = `${value}`;
}

function fillEmployeeFormDateField(name: EmployeeFormDateBoxNames, value: string | number): void {
  getFormDateFields()[name].value = `${value}`;
}

function getFormButtons(): HTMLElement[] {
  if (!cache.buttons) {
    cache.buttons = elements('button.gwt-Button.iwt-ButtonLarge');
  }
  return cache.buttons;
}

function getFormSelectFields(): HTMLSelectElement[] {
  if (!cache.formSelectFields) {
    cache.formSelectFields = elements('select.gwt-ListBox.iwt-Content');
  }
  return cache.formSelectFields;
}

export function fillContactDetailsStep(data: SwitzerlandPostingInfo) {
  fillFormField(FormFieldNames.HOST_COMPANY_NAME, data.hostCompanyName);
  fillFormField(FormFieldNames.HOST_COMPANY_STREET_ADDRESS, data.hostCompanyAddress.street);
  fillFormField(FormFieldNames.HOST_COMPANY_STREET_NUMBER, data.hostCompanyAddress.streetNumber);
  fillFormPostalCodeField(FormPostalCodeFieldNames.HOST_COMPANY_ADDRESS_CODE, data.hostCompanyAddress.postcode);
  fillFormField(FormFieldNames.CONTACT_PERSON_NAME, data.contactPerson.fullName);
  fillFormField(FormFieldNames.CONTACT_PERSON_TEL, data.contactPerson.address.telephone);
  fillFormField(FormFieldNames.CONTACT_PERSON_FAX, data.hostCompanyContactPersonFax);
  fillFormField(FormFieldNames.CONTACT_PERSON_EMAIL, data.contactPerson.address.email);
}

export function fillStayStep(data: SwitzerlandPostingInfo){
  fillFormDateField(FormDateBoxNames.START_DATE, moment(data.startDate).format('DD.MM.YYYY'));
  fillFormDateField(FormDateBoxNames.END_DATE, moment(data.endDate).format('DD.MM.YYYY'));
  const timeDiff = Math.abs(data.endDate - data.startDate);
  const daysOfPosting = Math.ceil(timeDiff / (1000 * 3600 * 24));
  fillFormField(FormFieldNames.TOTAL_DAYS, daysOfPosting);
}

export function fillPlaceOfWorkStep(data: SwitzerlandPostingInfo){
  // eslint-disable-next-line max-len
  fillFormField(FormFieldNames.WORK_PLACE_ADDRESS, `${data.workplaceAddress.city}, ${data.workplaceAddress.street} ${data.workplaceAddress.streetNumber}`);
  fillFormPostalCodeField(FormPostalCodeFieldNames.WORK_ADDRESS_CODE, data.workplaceAddress.postcode);
  fillFormField(FormFieldNames.PURPOSE_OF_SERViCE, data.purposeOfService);
}

async function fillEmployee(employee: PostingInfoEmployee, additionalInfo: SwitzerlandPostingAdditionalInfoEmployee) {
  fillFormField(FormFieldNames.EMPLOYEE_LAST_NAME, employee.lastName);
  fillFormField(FormFieldNames.EMPLOYEE_FIRST_NAME, employee.firstName);
  fillEmployeeFormDateField(EmployeeFormDateBoxNames.DATE_OF_BIRTH, moment(employee.dateOfBirth).format('DD.MM.YYYY'));
  if(employee.gender as unknown as string !== '1'){
    element('#gwt-uid-97').click();
  }
  selectValueByTextByNode(getFormSelectFields()[EmployeeFormDropdownNames.CITIZENSHIP], COUNTRIES[employee.nationality]);
  selectValueByTextByNode(getFormSelectFields()[EmployeeFormDropdownNames.TRADE], additionalInfo.trade);
  getFormSelectFields()[EmployeeFormDropdownNames.TRADE].dispatchEvent(new Event('change'));
  await sleep(100);
  selectValueByTextByNode(getFormSelectFields()[EmployeeFormDropdownNames.OCCUPATION], additionalInfo.occupation);
  // eslint-disable-next-line max-len
  selectValueByTextByNode(getFormSelectFields()[EmployeeFormDropdownNames.PROFESSIONAL_QUALIFICATION], additionalInfo.professionalQualification);
  selectValueByTextByNode(getFormSelectFields()[EmployeeFormDropdownNames.WAGE], additionalInfo.currency);
  fillFormField(FormFieldNames.GROSS_HOURLY_WAGE, additionalInfo.grossHourlyWage);
  fillFormField(FormFieldNames.SSN_NUMBER, additionalInfo.socialInsuranceNumber);
  fillEmployeeFormDateField(EmployeeFormDateBoxNames.RESIDENCE_PERMIT, moment(additionalInfo.residencePermitDate).format('DD.MM.YYYY'));

  elements('button.gwt-Button.iwt-ButtonLarge')[FormButtonNames.REGISTER_EMPLOYEE].click();
  await onMutation(document.body, () => element('div.titleLabel').innerHTML === 'Report short-term stays');
}

export async function fillEmployeesStep(data: SwitzerlandPostingInfo, selectEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);
  const employeeAdditionalInfo: Map<string, SwitzerlandPostingAdditionalInfoEmployee> = new Map();
  cache = {};

  for (const additionalInfo of data.employeeAdditionalInfo) {
    employeeAdditionalInfo.set(additionalInfo.employeeId, additionalInfo);
  }

  for (const employee of employees) {
    // elements('button.gwt-Button.iwt-ButtonLarge')[FormButtonNames.REGISTER_EMPLOYEE].click();
    getFormButtons()[FormButtonNames.REGISTER_EMPLOYEE].click();
    await onMutation(document.body, () => element('div.titleLabel').innerHTML === 'Register new employee');
    await fillEmployee(employee, employeeAdditionalInfo.get(employee.id));
  }
}

export function fillConfirmComplianceStep(){
  element('#gwt-uid-72').click();
  element('#gwt-uid-73').click();
  element('#gwt-uid-74').click();
  element('#gwt-uid-75').click();
  element('#gwt-uid-76').click();
}
