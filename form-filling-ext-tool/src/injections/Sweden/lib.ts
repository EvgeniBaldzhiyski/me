import moment from 'moment';
import { setPostingState } from '../utils/simplify-api';
import { element as defaultElement, elements, onMutation, selectValueByText } from '../utils/dom';
import { SwedenPostingInfo } from './interfaces';
import { PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

function setTextBox(node: HTMLInputElement, value: string) {
  node.focus();
  node.dispatchEvent(new Event('focus'));
  node.value = value;
  node.dispatchEvent(new Event('change'));
  node.dispatchEvent(new Event('input'));
}

async function fillFormCombo(id: string, value: string) {
  setTextBox(element(`#${id}`), value);

  const selector = `#${id}_listbox div.tt-suggestion`;

  await onMutation(document.body, () => elements(selector, true).length > 0);

  let match = '';

  for (const option of elements(selector)) {
    if (option.innerText.includes(value)) {
      match = option.innerText;
      option.click();
    }
  }

  if (match && element(`#${id}`).value !== match) {
    await onMutation(document.body, () => element(`#${id}`).value === match);
  }
}

async function fillFormInput(selector: string, value: string, waitingFor?: () => boolean) {
  setTextBox(element(selector), value);

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

async function goToNext(step: number) {
  await setPostingState({ step });

  element('button.postingbtn--next').click();
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

export async function fillHostCompanyData(data: SwedenPostingInfo) {
  await fillFormCombo('OrderCompanyInsertDto_OrderCompanyFind', data.hostCompanyRegistrationNumber);

  await goToNext(1);
}

export async function fillHostCompanyAddress(data: SwedenPostingInfo) {
  const {street, streetNumber, postcode, city} = data.hostCompanyAddress;

  await fillFormInput('#PlaceInsert_PlaceArea', `${street} ${streetNumber} ${postcode} ${city}`);

  await goToNext(2);
}

export async function addAllEmployees(data: SwedenPostingInfo, selectedEmployeeIds: string[]) {
  let inputRows = elements('#posting-application-postedemployees > div');

  if (selectedEmployeeIds.length < inputRows.length) {
    for (let i = selectedEmployeeIds.length; i < inputRows.length; i++) {
      inputRows[i].querySelector<HTMLAnchorElement>('a.remove-person.btn').click();
    }
  }

  if (selectedEmployeeIds.length > inputRows.length) {
    for (let i = inputRows.length; i < selectedEmployeeIds.length; i++) {
      element('a.postingbtn--add').click();

      await onMutation(document.body, () => !!elements('#posting-application-postedemployees > div')[i]);
    }
  }

  inputRows = elements('#posting-application-postedemployees > div');

  const employees = prepareSelectedEmployee(data.employees, selectedEmployeeIds);

  for (const [index, {pin, firstName, lastName}] of employees.entries()) {
    const {value} = inputRows[index].querySelector<HTMLInputElement>(
      'input[name="PostedEmployeesInsert.index"]'
    );

    await fillFormInput(`@PostedEmployeesInsert[${value}].PostedEmployeeBirthDate`, pin);
    await fillFormInput(`@PostedEmployeesInsert[${value}].PostedEmployeeFirstName`, firstName);
    await fillFormInput(`@PostedEmployeesInsert[${value}].PostedEmployeeLastName`, lastName);
    selectValueByText(`@PostedEmployeesInsert[${value}].PostedEmployeeAreaOfActivity`, 'Logging', 'include');
  }

  await goToNext(3);
}

export async function fillProjectPeriodOfActivities(data: SwedenPostingInfo, selectedEmployeeIds: string[]) {
  const inputRows = elements('#posting-application-interval > div');

  if (selectedEmployeeIds.length < inputRows.length) {
    for (let i = selectedEmployeeIds.length; i < inputRows.length; i++) {
      element('#posting-application-interval').removeChild(inputRows[i]);
    }
  }

  for (const index of selectedEmployeeIds.keys()) {
    await fillFormInput(`#PostedEmployeesInsert_${index}__PostedEmployeeStart`, moment(data.startDate).format('YYYY-MM-DD'));
    await fillFormInput(`#PostedEmployeesInsert_${index}__PostedEmployeeEnd`, moment(data.endDate).format('YYYY-MM-DD'));
  }

  await goToNext(4);
}

export async function fillPostingSituations(data: SwedenPostingInfo) {
  selectValueByText('#MainSituation', data.postingSituations);

  await goToNext(5);
}

export async function fillContactPerson(data: SwedenPostingInfo) {
  const {pin, firstName, lastName, address: {
    street, streetNumber, postcode, city, email, telephone
  }} = data.contactPerson;

  await fillFormInput('#ContactInsert_ContactFirstName', firstName);
  await fillFormInput('#ContactInsert_ContactLastName', lastName);
  await fillFormInput('#ContactInsert_ContactBirthDate',  pin);
  await fillFormInput('#ContactInsert_ContactAdress', `${street} ${streetNumber}`);
  await fillFormInput('#ContactInsert_ContactPostNumber', postcode);
  await fillFormInput('#ContactInsert_ContactPostCity', city);
  await fillFormInput('#ContactInsert_ContactEmail', email);
  await fillFormInput('#ContactInsert_ContactPhone', telephone);

  await goToNext(6);
}
