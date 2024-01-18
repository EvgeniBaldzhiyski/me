import moment from 'moment';
import { element as defaultElement, elements, onMutation } from '../utils/dom';
import { FinlandPostingInfo } from './interfaces';
import { COUNTRIES } from './maps';
import { PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';

enum countryFieldIndexes {
  NotificationType = 6,
  Contractor = 5,
  Builder = 7,
  MainContractor = 13,
  PlaceOfWork = 0,
}

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
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

function addressToSet(data: PostingInfoAddress) {
  const { city, postcode, street, streetNumber } = data;
  return `${city}, ${postcode}, ${street} ${streetNumber}`;
}

async function fillFormCombo(fieldSelector: string, option: number | string, listIndex: number, waitingFor?: () => boolean) {
  element(fieldSelector).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const multiList = elements('.MuiList-root.MuiMenu-list.MuiList-padding');

  if (!(multiList[listIndex] && multiList[listIndex].querySelectorAll('li').length > 0)) {
    await onMutation(document.body, () => {
      try {
        return (elements('.MuiList-root.MuiMenu-list.MuiList-padding')[listIndex].querySelectorAll('li').length > 0);
      } catch (err) {
        return false;
      }
    });
  }

  const options = elements('.MuiList-root.MuiMenu-list.MuiList-padding')[listIndex].querySelectorAll('li');

  if (typeof option === 'number') {
    options[option].click();
    if (waitingFor) {
      await onMutation(document.body, waitingFor);
    }
    return;
  }

  for (const opt of Array.from(options)) {
    if (opt.innerText === option) {
      opt.click();
      if (waitingFor) {
        await onMutation(document.body, waitingFor);
      }
    }
  }
}

async function fillFormCountryCombo(countryFieldIndex: number | string, listIndex: number, stringToCompare: string) {
  const countryDropdown = elements('input')[countryFieldIndex];
  countryDropdown.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const multiList = elements('.MuiAutocomplete-listbox');

  if (!(multiList[listIndex] && multiList[listIndex].querySelectorAll('li').length > 0)) {
    await onMutation(document.body, () => {
      try {
        return (elements('.MuiAutocomplete-listbox')[listIndex].querySelectorAll('li').length > 0);
      } catch (err) {
        return false;
      }
    });
  }

  // we are doing refresh search because a mutation above
  const options = elements('.MuiAutocomplete-listbox')[listIndex].querySelectorAll('li');

  for (const opt of Array.from(options)) {
    if (opt.innerText === stringToCompare) {
      opt.click();
    }
  }
}

function fillFormInput(fieldSelector: string, value: string) {
  const el = element(fieldSelector);

  el.dispatchEvent(new Event('focusin', {bubbles: true}));

  el.value = value;

  el.dispatchEvent(new Event('change', {bubbles: true}));
  el.dispatchEvent(new Event('focusout', {bubbles: true}));
}

export async function run() {
  elements('span.MuiButton-label')[2].click();
  await onMutation(document.body, () => !!element('#root_7_1'));
}

export async function fillNotificationTypeStep(data: FinlandPostingInfo) {
  await fillFormCombo('#root_6', 0, 2);

  fillFormInput('#root_7_1', data.postingCompanyName);
  fillFormInput('#root_7_2', data.postingCompanyRegistrationNumber);
  fillFormInput('#root_7_3', data.postCompanyBusinessId);
  fillFormInput('#root_7_4', data.postingCompanyVatNumber);
  fillFormInput('#root_7_5', addressToSet(data.postingCompanyAddress));

  await fillFormCountryCombo(countryFieldIndexes.NotificationType, 0, COUNTRIES[data.postingCompanyAddress.country]);

  fillFormInput('#root_7_8', data.recipientPerson.fullName);
  fillFormInput('#root_7_9', data.postingCompanyAddress.email);
  fillFormInput('#root_7_10', data.postingCompanyAddress.telephone);
  const startDateObj = moment(data.startDate);
  const endDateObj = moment(data.endDate);
  const daysOfPosting = Math.round(endDateObj.diff(startDateObj, 'days'));
  if (daysOfPosting > 10) {
    await fillFormCombo('#root_9', 0, 3, () => true);

    fillFormInput('#root_10_0', data.representativePerson.fullName);
    fillFormInput('#root_10_1', addressToSet(data.representativePerson.address));
    fillFormInput('#root_10_2', data.representativePerson.address.email);
    fillFormInput('#root_10_3', data.representativePerson.address.telephone);
  } else {
    await fillFormCombo('#root_9', 1, 3);
  }

  elements('span.MuiButton-label')[3].click();
  await onMutation(document.body, () => !!element('#root_12_1'));
}

export async function fillContractorStep(data: FinlandPostingInfo) {
  fillFormInput('#root_12_1', data.hostCompanyName);
  fillFormInput('#root_12_2', data.hostCompanyBusinessId);
  fillFormInput('#root_12_3', data.hostCompanyRegistrationNumber);
  fillFormInput('#root_12_5', addressToSet(data.hostCompanyAddress));
  await fillFormCountryCombo(countryFieldIndexes.Contractor, 0, COUNTRIES[data.hostCompanyAddress.country]);
  fillFormInput('#root_12_8', data.hostCompanyAddress.email);
  fillFormInput('#root_12_9', data.hostCompanyAddress.telephone);

  elements('span.MuiButton-label')[3].click();
  await onMutation(document.body, () => !!element('#root_15-input'));
}

async function fillBuilderAndContractor(data: FinlandPostingInfo) {
  // Builder
  fillFormInput('#root_16_1', data.builderName);
  fillFormInput('#root_16_3', data.builderBusinessId);
  fillFormInput('#root_16_4', data.builderRegistrationNumber);
  fillFormInput('#root_16_6', addressToSet(data.builderAddress));
  await fillFormCountryCombo(countryFieldIndexes.Builder, 0, COUNTRIES[data.builderAddress.country]);
  // Main contractor
  fillFormInput('#root_18_1', data.mainContractorName);
  fillFormInput('#root_18_2', data.mainContractorBusinessId);
  fillFormInput('#root_18_3', data.mainContractorRegistrationNumber);
  fillFormInput('#root_18_5', addressToSet(data.mainContractorAddress));
  await fillFormCountryCombo(countryFieldIndexes.MainContractor, 0, COUNTRIES[data.mainContractorAddress.country]);
}

export async function fillWorkingStep(data: FinlandPostingInfo) {
  const { code, description } = data.postCompanyBusinessSectorsDto[1];
  const strToCompare = `${code.replace('.', '')} ${description}`;
  await fillFormCombo('#root_14', strToCompare, 2, () => true);
  if (data.workDoneInConstructionSector) {
    await fillFormCombo('#root_15', 0, 2, () => true);
    await fillBuilderAndContractor(data);
  } else {
    await fillFormCombo('#root_15', 1, 2, () => true);
  }

  elements('span.MuiButton-label')[3].click();
  await onMutation(document.body, () => !!element('#root_20_3'));
}
export async function fillPlaceOfWorkStep(data: FinlandPostingInfo) {
  await fillFormCountryCombo(countryFieldIndexes.PlaceOfWork, 0, data.workPlaceAddress.municipality);
  fillFormInput('#root_20_3', addressToSet(data.workPlaceAddress));
  fillFormInput('#root_20_4', data.additionalInformation);
}
function fillEmployee(employee: PostingInfoEmployee, data: FinlandPostingInfo, index: number) {
  const additionInfo = data.employeeAdditionalInfo.find((e) => e.employeeId === employee.id);
  const prefixId = '2627039';

  fillFormInput(`#${prefixId}-${index}-0`, employee.firstName);
  fillFormInput(`#${prefixId}-${index}-1`, employee.lastName);
  fillFormInput(`#${prefixId}-${index}-2`, employee.pin);
  fillFormInput(`#${prefixId}-${index}-3`, additionInfo.taxIdentificationNumber);
  fillFormInput(`#${prefixId}-${index}-4`, moment(data.startDate).format('DD.MM.YYYY'));
  fillFormInput(`#${prefixId}-${index}-5`, moment(data.endDate).format('DD.MM.YYYY'));
  fillFormInput(`#${prefixId}-${index}-6`, additionInfo.finishTaxNumber);
}

export function fillPostedWorkersStep(data: FinlandPostingInfo, selectEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);

  for (const [index, employee] of employees.entries()) {
    fillEmployee(employee, data, index);
  }

  const radioParentElement = element('fieldset.MuiFormControl-root');
  const radioToClick = radioParentElement.querySelectorAll('input')[1];
  radioToClick.click();
}
