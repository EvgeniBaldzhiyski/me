import {
  element as defaultElement,
  elements,
  onMutation,
  selectValueByText,
} from '../utils/dom';
import { COUNTRIES2, IDENTIFY_NUMBER_TYPE2 } from './maps';
import { PortugalPostingInfo } from './interfaces';
import moment from 'moment';
import { PostingInfoEmployee } from '../../utils/interfaces';

const PREFIX_ID = 'ctl00_ctl49_g_df664a18_f8f1_4f2f_b1af_3468cf84b254_ctl00_';

function element<R extends HTMLInputElement | HTMLSelectElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

async function setDropdownValueOptionalMutation(
  node: HTMLInputElement,
  text: string,
  waitingFor?: () => boolean
) {
  node.value = text;
  node.dispatchEvent(new Event('change'));

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
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

function addressToSet(data) {
  const { street, streetNumber } = data;
  return `${street}, ${streetNumber}`;
}

async function clickButtonBy(el: HTMLElement, waitingFor = () => true) {
  el.click();

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

export function fillEmployerStep(data: PortugalPostingInfo) {
  element(`#${PREFIX_ID}FormEmailEnt_singleLineTextBox`).value =
    data.postingCompanyName;
  element(`#${PREFIX_ID}ctl01_singleLineTextBox`).value =
    data.postingCompanyRegistrationNumber;
  element(`#${PREFIX_ID}txtmorada_singleLineTextBox`).value = addressToSet(
    data.postingCompanyAddress
  );
  element(`#${PREFIX_ID}ctl02_singleLineTextBox`).value =
    data.postingCompanyAddress.postcode;
  element(`#${PREFIX_ID}ctl03_singleLineTextBox`).value =
    data.postingCompanyAddress.city;
  selectValueByText(
    `#${PREFIX_ID}ddlPais`,
    COUNTRIES2[data.postingCompanyAddress.country]
  );
  element(`#${PREFIX_ID}txtToEmailAddress_singleLineTextBox`).value =
    data.postingCompanyAddress.email;
  element(`#${PREFIX_ID}ctl04_singleLineTextBox`).value =
    data.postingCompanyAddress.telephone;
}

async function fillEmployee(employee: PostingInfoEmployee, data: PortugalPostingInfo) {
  const additionInfo = data.employeeAdditionalInfo.find(
    (e) => e.employeeId === employee.id
  );
  element(`#${PREFIX_ID}ctl05_singleLineTextBox`).value = employee.fullName;
  selectValueByText(
    `#${PREFIX_ID}DropDownList1`,
    IDENTIFY_NUMBER_TYPE2[additionInfo.identifyNumberType as string]
  );
  element(`#${PREFIX_ID}ctl06_singleLineTextBox`).value =
    additionInfo.identifyNumber;
  element(`#${PREFIX_ID}ctl07_singleLineTextBox`).value =
    additionInfo.professionalCategory;
  element(`#${PREFIX_ID}datecontrol1`).value = moment(
    employee.dateOfBirth
  ).format('DD/MM/YYYY');
  selectValueByText(
    `#${PREFIX_ID}ddlNacionalidade`,
    COUNTRIES2[employee.nationality]
  );
  if ((employee.gender as unknown as string) === '1') {
    element(`#${PREFIX_ID}chkMasculino`).click();
  } else if ((employee.gender as unknown as string) === '2') {
    element(`#${PREFIX_ID}chkFeminino`).click();
  } else {
    element(`#${PREFIX_ID}chkOutro`).click();
  }
  element(`#${PREFIX_ID}copymorada_singleLineTextBox`).value = addressToSet(
    additionInfo.workPlaceAddress
  );
  await setDropdownValueOptionalMutation(
    element('#distrito-drop-1'),
    additionInfo.workPlaceAddress.district,
    () => !!element('#concelho-drop-1')
  );
  await setDropdownValueOptionalMutation(
    element('#concelho-drop-1'),
    additionInfo.workPlaceAddress.municipality
  );
  element(`#${PREFIX_ID}copylocalidade_singleLineTextBox`).value =
    additionInfo.workPlaceAddress.city;

  const postCodeArr = additionInfo.workPlaceAddress.postcode.split('-');
  element('@cod1').value = postCodeArr[0];
  element('@cod2').value = postCodeArr[1];
}

async function fillNewEmployee(employee: PostingInfoEmployee, data: PortugalPostingInfo, index: number) {
  const additionInfo = data.employeeAdditionalInfo.find(
    (e) => e.employeeId === employee.id
  );
  element(`#tbl1txt-${index}`).value = employee.fullName;
  selectValueByText(
    `#tbl1select-${index}`,
    IDENTIFY_NUMBER_TYPE2[additionInfo.identifyNumberType as string]
  );
  element(`#tbl1num-${index}`).value = additionInfo.identifyNumber;
  element(`#tbl1txt2-${index}`).value = additionInfo.professionalCategory;
  element(`#tbl1data-${index}`).value = moment(employee.dateOfBirth).format(
    'DD/MM/YYYY'
  );
  selectValueByText(`#tbl1txt3-${index}`, COUNTRIES2[employee.nationality]);
  if ((employee.gender as unknown as string) === '1') {
    element(`#tbl1chk-${index}`).click();
  } else if ((employee.gender as unknown as string) === '2') {
    element(`#tbl1chk2-${index}`).click();
  } else {
    element(`#tbl1chk3-${index}`).click();
  }
  element(`#tbl1txt4-${index}`).value = addressToSet(
    additionInfo.workPlaceAddress
  );
  element(`#distrito${index + 2}`).dispatchEvent(new Event('click'));
  await onMutation(
    document,
    () => element<HTMLSelectElement>(`#distrito${index + 2}`).options.length > 1
  );
  await setDropdownValueOptionalMutation(
    element(`#distrito${index + 2}`),
    additionInfo.workPlaceAddress.district,
    () => element<HTMLSelectElement>(`#concelhoempty${index + 2}`).length > 1
  );
  await setDropdownValueOptionalMutation(
    element(`#concelhoempty${index + 2}`),
    additionInfo.workPlaceAddress.municipality
  );
  element(`#tbl1txt6-${index}`).value = additionInfo.workPlaceAddress.city;

  const postCodeArr = additionInfo.workPlaceAddress.postcode.split('-');
  element(`#tbl1cod-${index}`).value = postCodeArr[0];
  element(`#tbl1cod2-${index}`).value = postCodeArr[1];
}

/* index  emplCount  parentDiv selector    addButton Id selector
//   0        1      TrabalhadorRepleg          -----------
//   1        2      TrabalhadorRepleg0   - TrabalhadorRepleg-add-1
//   2        3      TrabalhadorRepleg-1  - TrabalhadorRepleg-add-1
//   3        4      TrabalhadorRepleg-2  - TrabalhadorRepleg-add-2
//   4        5      TrabalhadorRepleg-3  - TrabalhadorRepleg-add-3
//   5        6      TrabalhadorRepleg-4  - TrabalhadorRepleg-add-4
*/
export async function fillEmployeesStep(
  data: PortugalPostingInfo,
  selectEmployeeIds: string[]
) {
  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);
  for (const [index, employee] of employees.entries()) {
    if (index === 1) {
      await clickButtonBy(element(`#TrabalhadorRepleg-add-${index}`));
    }
    if (index > 1) {
      await clickButtonBy(element(`#TrabalhadorRepleg-add-${index - 1}`));
    }
    // ---------
    if (index === 0) {
      await fillEmployee(employee, data);
    } else {
      await fillNewEmployee(employee, data, index);
    }
  }
}

export async function fillHostCompanyStep(data: PortugalPostingInfo) {
  element(`#${PREFIX_ID}SingleLineTextBox2_singleLineTextBox`).value =
    data.hostCompanyName;
  element(`#${PREFIX_ID}NIF_singleLineTextBox`).value =
    data.hostCompanyRegistrationNumber;
  element(`#${PREFIX_ID}NISS_singleLineTextBox`).value =
    data.hostCompanySocialSecurityNumber;
  element(`#${PREFIX_ID}SingleLineTextBox5_singleLineTextBox`).value =
    addressToSet(data.hostCompanyAddress);
  const postCodeArr = data.hostCompanyAddress.postcode.split('-');
  element('@cod3').value = postCodeArr[0];
  element('@cod4').value = postCodeArr[1];
  element(`#${PREFIX_ID}ctl08_singleLineTextBox`).value =
    data.hostCompanyAddress.city;
  await setDropdownValueOptionalMutation(
    element('#distrito-drop-2'),
    data.hostCompanyAddress.district,
    () => !!element('#concelho-drop-2')
  );
  await setDropdownValueOptionalMutation(
    element('#concelho-drop-2'),
    data.hostCompanyAddress.municipality
  );
  const activities = elements('.row.chkvalidation2 div');
  const descrStrEl = activities.find((item) =>
    item.innerHTML.includes(data.hostStateCountryBusinessSector.description)
  );
  descrStrEl.querySelector('input').click();
}

export function fillDurationOfPostingStep(data: PortugalPostingInfo) {
  element(`#${PREFIX_ID}datecontrol4`).value = moment(data.startDate).format(
    'DD/MM/YYYY'
  );
  element(`#${PREFIX_ID}datecontrol5`).value = moment(data.endDate).format(
    'DD/MM/YYYY'
  );
}

export function fillContactPersonStep(data: PortugalPostingInfo) {
  element(`#${PREFIX_ID}SingleLineTextBox1_singleLineTextBox`).value =
    data.contactPerson.fullName;
  element(`#${PREFIX_ID}SingleLineTextBox3_singleLineTextBox`).value =
    addressToSet(data.contactPerson.address);
  element(`#${PREFIX_ID}ctl09_singleLineTextBox`).value =
    data.contactPerson.address.postcode;
  element(`#${PREFIX_ID}ctl10_singleLineTextBox`).value =
    data.contactPerson.address.city;
  element(`#${PREFIX_ID}SingleLineTextBox4_singleLineTextBox`).value =
    data.contactPerson.address.email;
  element(`#${PREFIX_ID}ctl11_singleLineTextBox`).value =
    data.contactPerson.address.telephone;
}
