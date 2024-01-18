import { element as defaultElement, elements, onMutation, selectValueByTextByNode, sleep } from '../utils/dom';
import { COUNTRIES } from './maps';
import moment from 'moment';
import { NetherlandsPostingInfo, PerformedWorkAddressType } from './interfaces';
import { PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

async function setTextBox(node: HTMLInputElement, value: string | number, waitingFor?: () => boolean) {
  node.focus();
  node.lang = 'setTextBox';
  node.value = `${value}`;
  node.dispatchEvent(new Event('change'));
  node.blur();

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

async function setSelectByTest(node: HTMLSelectElement, text: string, waitingFor = () => true) {
  selectValueByTextByNode(node, text);
  node.dispatchEvent(new Event('change'));

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

async function fillFormControl(selector: string, value: string | number, waitingFor?: () => boolean) {
  await setTextBox(element(selector), value, waitingFor);
}

async function fillFormNodeCombo(node: HTMLElement, match: string, waitingFor = () => true): Promise<boolean> {
  node.dispatchEvent(new Event('mousedown'));

  const regexp = new RegExp(`^${match}`);

  for (const li of elements('ul.select2-results li')) {
    if (regexp.test(li.innerText)) {
      if (li.innerText !== node.innerText) {
        li.dispatchEvent(new Event('mouseup', {bubbles: true}));

        if (waitingFor) {
          await onMutation(document.body, waitingFor);
        }
      }
      return true;
    }
  }

  return false;
}

function fillFormComboBy(selector: string, match: string, waitingFor = () => true): Promise<boolean> {
  return fillFormNodeCombo(element(selector), match, waitingFor);
}

function fillFormCombo(match: string, waitingFor = () => true): Promise<boolean> {
  return fillFormComboBy('a.select2-default', match, waitingFor);
}

async function fillFormRadio(match: string, index = 0, waitingFor = () => true) {
  const el = elements(match)[index];

  el.click();

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

async function clickButtonBy(el: HTMLElement, waitingFor = () => true) {
  el.click();

  if (waitingFor) {
    await onMutation(document.body, waitingFor);
  }
}

function clickButton(selector: string, waitingFor = () => true) {
  return clickButtonBy(element(selector), waitingFor);
}


export async function fillNotificationTypeStep(data: NetherlandsPostingInfo) {
  await fillFormCombo(data.postCompanyBusinessSectorsDto[0].code, () => true);
  await fillFormCombo(data.postCompanyBusinessSectorsDto[1].code, () => true);
  await fillFormCombo(data.postCompanyBusinessSectorsDto[2].code.replace('.', ''), () => true);

  await clickButton('button.btn.btn-primary.pull-right');
}

export async function fillReporterStep(data: NetherlandsPostingInfo) {
  await fillFormControl('#P979-C0-C1-C1-C0-F0', data.reporterPerson.firstName);
  await fillFormControl('#P979-C0-C1-C1-C0-F2', data.reporterPerson.lastName);
  await fillFormControl('#P979-C0-C1-C1-C1-F0', data.reporterPerson.address.telephone);
  await fillFormControl('#P979-C0-C1-C1-C1-F2', data.reporterPerson.address.email);

  await clickButton('button.btn.btn-primary.pull-right');
}

async function fillCompanyInformation(data: NetherlandsPostingInfo) {
  await fillFormRadio('@P743-C0-C1-C3-C1-F0', 1);

  await fillFormCombo(COUNTRIES[data.postingCompanyAddress.country], () => true);

  if (!data.postCompanyKVKNumber) {
    if (data.postingCompanyRegistrationNumber) {
      await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F9', data.postingCompanyRegistrationNumber, () => true);
    } else {
      await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-F4', 1);
    }

    await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F12', data.postingCompanyName, () => true);
  } else {
    await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-F3');
    await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-C6-F0', 1);

    await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F7', data.postCompanyKVKNumber, () => true);

    if (data.postCompanyBranchNumber !== '') {
      await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-F8');

      await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F10', data.postCompanyBranchNumber, () => true);
    } else {
      await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-F8', 1);
    }

    await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F11', data.postCompanyRSINNumber, () => true);
    await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F12', data.postingCompanyName, () => true);
  }

  if (data.postingCompanyVatNumber) {
    await fillFormControl('#P743-C0-C1-C3-C2-C0-C1-F18', data.postingCompanyVatNumber, () => true);
  } else {
    await fillFormRadio('@P743-C0-C1-C3-C2-C0-C1-F17', 1);
  }
}

async function fillBusinessAddress(data: NetherlandsPostingInfo) {
  await setTextBox(
    element('label[for="P743-C0-C1-C3-C3-C0-C0-C0-F1"]').parentElement.querySelector('input'),
    data.postingCompanyAddress.streetNumber
  );
  await fillFormControl('#P743-C0-C1-C3-C3-C0-C0-C0-F0', data.postingCompanyAddress.street);
  await fillFormControl('#P743-C0-C1-C3-C3-C0-C0-C1-F0', data.postingCompanyAddress.postcode);
  await fillFormControl('#P743-C0-C1-C3-C3-C0-C0-C1-F1', data.postingCompanyAddress.city);

  return Promise.resolve();
}

async function fillLegalRepresentative({representativePerson,representativeCitizenServiceNumber}: NetherlandsPostingInfo) {
  await fillFormCombo(COUNTRIES[representativePerson.nationality], () => true);

  await setTextBox(
    element('label[for="P743-C0-C1-C3-C4-C0-C3-C0-C1-F0"]').parentElement.querySelector('input'),
    moment(representativePerson.dateOfBirth).format('DD-MM-YYYY')
  );
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C0-F0', representativePerson.firstName);
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C0-F2', representativePerson.lastName);
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C2-F0', representativePerson.pin, () => true);
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C2-F1', representativeCitizenServiceNumber);
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C3-F0', representativePerson.address.telephone);
  await fillFormControl('#P743-C0-C1-C3-C4-C0-C3-C0-C3-F2', representativePerson.address.email);
}

async function fillContactPersonActing({contactPerson, contactCitizenServiceNumber}: NetherlandsPostingInfo) {
  await fillFormCombo(COUNTRIES[contactPerson.nationality], () => true);

  await setTextBox(
    element('label[for="P743-C0-C1-C3-C5-C0-C2-C1-C1-F0"]').parentElement.querySelector('input'),
    moment(contactPerson.dateOfBirth).format('DD-MM-YYYY')
  );
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C0-F0', contactPerson.firstName);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C0-F2', contactPerson.lastName);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C2-F0', contactPerson.pin, () => true);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C2-F1', contactCitizenServiceNumber);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C3-F0', contactPerson.address.telephone);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C1-C3-F1', contactPerson.address.email);
}

async function fillAddressContactPerson({contactPerson}: NetherlandsPostingInfo) {
  if (!contactPerson.address.city) {
    await fillFormRadio('@P743-C0-C1-C3-C5-C0-C2-C3-F0', 1);

    return;
  }

  await fillFormRadio('@P743-C0-C1-C3-C5-C0-C2-C3-C1-C0-C0-F0');

  await setTextBox(
    element('label[for="P743-C0-C1-C3-C5-C0-C2-C3-C1-C0-C0-C1-F1"]').parentElement.querySelector('input'),
    contactPerson.address.streetNumber,
    () => true
  );
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C3-C1-C0-C0-C1-F0', contactPerson.address.postcode, () => true);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C3-C1-C0-C1-F0', contactPerson.address.street, () => true);
  await fillFormControl('#P743-C0-C1-C3-C5-C0-C2-C3-C1-C0-C1-F1', contactPerson.address.city, () => true);
}

export async function fillEmployerStep(data: NetherlandsPostingInfo) {
  await fillCompanyInformation(data);
  await fillBusinessAddress(data);
  await fillLegalRepresentative(data);
  await fillContactPersonActing(data);
  await fillAddressContactPerson(data);

  await clickButton('button.btn.btn-primary.pull-right');
}

async function serviceRecipientStepCompanyInfo(data: NetherlandsPostingInfo) {
  await fillFormRadio('@P785-C0-C2-C0-C0-F0', 1); // Show only EEA countries
  await fillFormRadio('@P785-C0-C2-C0-C1-C1-C0-C6-F0', 1); // verify the company's details in the Dutch trade register, always no

  const hostCompanyCountryName = COUNTRIES[data.hostCompanyAddress.country];

  await fillFormComboBy('.select2-container a', hostCompanyCountryName); // Country of establishment

  if (data.hostCompanyKVKNumber) {
    if (hostCompanyCountryName !== 'Netherlands') {
      await fillFormRadio('@P785-C0-C2-C0-C1-C1-C0-F2', 0); // Registered in the Dutch Chamber of Commerce
    }

    await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F7', data.hostCompanyKVKNumber, () => true);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F9', data.hostCompanyBranchNumber, () => true);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F10', data.hostCompanyRSINNumber, () => true);
  } else {
    // eslint-disable-next-line no-lonely-if
    if (hostCompanyCountryName === 'Netherlands') {
      await fillFormRadio('@P785-C0-C2-C0-C1-C1-C0-F2', 1); // Registered in the Dutch Chamber of Commerce
    }else {
      // eslint-disable-next-line no-lonely-if
      if (data.hostCompanyRegistrationNumber) {
        await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F8', data.hostCompanyRegistrationNumber, () => true);
      } else {
        await fillFormRadio('@P785-C0-C2-C0-C1-C1-C0-F4', 1);
      }
    }
  }
  await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F11', data.hostCompanyName);

  if (data.hostCompanyVatNumber) {
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C0-F17', data.hostCompanyVatNumber, () => true);
  } else {
    await fillFormRadio('@P785-C0-C2-C0-C1-C1-C0-F16', 1);
  }
}

async function serviceRecipientStepAddress({hostCompanyAddress}: NetherlandsPostingInfo) {
  if (COUNTRIES[hostCompanyAddress.country] === 'Netherlands') {
    await fillFormRadio('@P785-C0-C2-C0-C1-C1-C1-C0-C0-C0-F0', 0);

    await setTextBox(
      element('label[for="P785-C0-C2-C0-C1-C1-C1-C0-C0-C0-C1-F1"]').parentElement.querySelector('input'),
      hostCompanyAddress.streetNumber,
      () => true
    );
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C0-C0-C0-C1-F0', hostCompanyAddress.postcode, () => true);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C0-C0-C1-F0', hostCompanyAddress.street, () => true);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C0-C0-C1-F1', hostCompanyAddress.city, () => true);
  } else {
    await setTextBox(
      element('label[for="P785-C0-C2-C0-C1-C1-C1-C1-C0-C0-F1"]').parentElement.querySelector('input'),
      hostCompanyAddress.streetNumber
    );
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C1-C0-C1-F0', hostCompanyAddress.postcode);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C1-C0-C0-F0', hostCompanyAddress.street);
    await fillFormControl('#P785-C0-C2-C0-C1-C1-C1-C1-C0-C1-F1', hostCompanyAddress.city);
  }
}

async function serviceRecipientStepDetailsOfContact({recipientPerson}: NetherlandsPostingInfo) {
  await fillFormControl('#P785-C0-C2-C0-C2-C0-C2-C0-F0', recipientPerson.firstName);
  await fillFormControl('#P785-C0-C2-C0-C2-C0-C2-C0-F2', recipientPerson.lastName);
  await fillFormControl('#P785-C0-C2-C0-C2-C0-C2-C1-F0', recipientPerson.address.telephone);
  await fillFormControl('#P785-C0-C2-C0-C2-C0-C2-C1-F1', recipientPerson.address.email, () => true);
}

export async function fillServiceRecipientStep(data: NetherlandsPostingInfo) {
  await serviceRecipientStepCompanyInfo(data);
  await serviceRecipientStepAddress(data);
  await serviceRecipientStepDetailsOfContact(data);

  await clickButton('button.btn.btn-primary.pull-right');
}

async function fillProjectNone(data: NetherlandsPostingInfo) {
  await fillFormRadio('@P903-C0-C1-C2-C0-C0-F0');
  await fillFormRadio('@P903-C0-C1-C2-C0-C2-C0-C0-C0-F0');

  await setTextBox(
    element('label[for="P903-C0-C1-C2-C0-C2-C0-C0-C0-C1-F1"]').parentElement.querySelector('input'),
    data.performedWorkAddress.addressDto.streetNumber,
    () => true
  );

  await fillFormControl('#P903-C0-C1-C2-C0-C2-C0-C0-C0-C1-F0', data.performedWorkAddress.addressDto.postcode, () => true);
  await fillFormControl('#P903-C0-C1-C2-C0-C2-C0-C0-C1-F0', data.performedWorkAddress.addressDto.street, () => true);
  await fillFormControl('#P903-C0-C1-C2-C0-C2-C0-C0-C1-F1', data.performedWorkAddress.addressDto.city, () => true);

  await fillFormControl('#P903-C0-C1-C2-C0-C2-F1', data.performedWorkAddress.addressDto.telephone);
  await fillFormControl('#P903-C0-C1-C2-C0-C2-F2', data.performedWorkAddress.addressDto.email);
}

async function fillProjectNoNone(data: NetherlandsPostingInfo) {
  await fillFormRadio('@P903-C0-C1-C2-C0-C0-F0', 1);

  await setSelectByTest(
    element('label[for=P903-C0-C1-C2-C0-C1-F0]').parentElement.querySelector('select'),
    data.performedWorkAddressType
  );

  if (data.performedWorkAddressType === PerformedWorkAddressType.GEO_LOCATION) {
    await fillFormControl(
      '#P903-C0-C1-C2-C0-C1-C2-F0',
      `${data.performedWorkAddress.addressDto.longitude}, ${data.performedWorkAddress.addressDto.latitude}`
    );
    return;
  }

  if (data.performedWorkAddressType === PerformedWorkAddressType.TRANSPORT){
    if (data.licensePlateVehicle !== '') {
      await fillFormRadio('@P903-C0-C1-C2-C0-C1-C3-C0-F0', 1);
      await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-F2', data.licensePlateVehicle);
      return;
    }
    await fillFormRadio('@P903-C0-C1-C2-C0-C1-C3-C0-F0', 0);
    await fillFormRadio('@P903-C0-C1-C2-C0-C1-C3-C1-C0-C1-C0-F0', 0);
    await setTextBox(
      element('label[for="P903-C0-C1-C2-C0-C1-C3-C1-C0-C1-C0-C1-F1"]').parentElement.querySelector('input'),
      data.performedWorkAddress.addressDto.streetNumber,
      () => true
    );
    await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-C1-C0-C1-C0-C1-F0', data.performedWorkAddress.addressDto.postcode, () => true);
    await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-C1-C0-C1-C1-F0', data.performedWorkAddress.addressDto.street, () => true);
    await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-C1-C0-C1-C1-F1', data.performedWorkAddress.addressDto.city, () => true);

    await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-C1-C0-F2', data.performedWorkAddress.addressDto.telephone);
    await fillFormControl('#P903-C0-C1-C2-C0-C1-C3-C1-C0-F3', data.performedWorkAddress.addressDto.email);
  }
}

async function fillProjectScheduledPeriod(data: NetherlandsPostingInfo) {
  const index = (element('label[for="P903-C0-C1-C3-C1-F0"]', true) ? 0 : 1);

  await setTextBox(
    element(`label[for="P903-C0-C1-C3-C1-F${0 + index}"]`).parentElement.querySelector('input'),
    moment(data.startDate).format('DD-MM-YYYY'),
    () => true
  );
  await setTextBox(
    element(`label[for="P903-C0-C1-C3-C1-F${1 + index}"]`).parentElement.querySelector('input'),
    moment(data.endDate).format('DD-MM-YYYY'),
    () => true
  );
}

async function fillProjectWagePayments(data: NetherlandsPostingInfo) {
  if (!data.responseCompanyName) {
    await fillFormRadio('@P903-C0-C1-C5-F0', 0);
    return;
  }

  await fillFormRadio('@P903-C0-C1-C5-F0', 1);
  await fillFormRadio('@P903-C0-C1-C5-F1', 1);

  const responseCompanyCountryName = COUNTRIES[data.responseCompanyCountry];

  await fillFormNodeCombo(elements('.select2-container a')[3], responseCompanyCountryName);

  if (data.responseCompanyKVKNumber) {
    if (responseCompanyCountryName !== 'Netherlands') {
      await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C1-F1', 0); // Registered in the Dutch Chamber of Commerce
    }

    await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C1-C4-F0', 1); // Do you want to verify the company's details in the Dutch trade register?

    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F5', data.responseCompanyKVKNumber, () => true);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F6', data.responseCompanyBranchNumber);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F8', data.responseCompanyName);
  } else {
    // eslint-disable-next-line no-lonely-if
    if (responseCompanyCountryName === 'Netherlands') {
      await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C1-F1', 1); // Registered in the Dutch Chamber of Commerce
    }

    if (data.responseCompanyRegistrationNumber) {
      await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F7', data.responseCompanyRegistrationNumber);
    } else {
      await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C1-F2', 1);
    }
  }
  await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F8', data.responseCompanyName);

  if (data.responseCompanyVatNumber) {
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F14', data.responseCompanyVatNumber);
  } else {
    await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C1-F13', 1);
  }

  await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F16', data.responseCompanyEmail);
  await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C1-F17', data.responseCompanyTelephone);

  if (COUNTRIES[data.responseCompanyCountry] === 'Netherlands') {
    await fillFormRadio('@P903-C0-C1-C5-C3-C1-C0-C2-C0-C0-C0-F0', 0);

    await setTextBox(
      element('label[for="P903-C0-C1-C5-C3-C1-C0-C2-C0-C0-C0-C1-F1"]').parentElement.querySelector('input'),
      data.responseCompanyAddress.streetNumber,
      () => true
    );
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C0-C0-C1-F0', data.responseCompanyAddress.postcode, () => true);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C0-C1-F0', data.responseCompanyAddress.street, () => true);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C0-C1-F1', data.responseCompanyAddress.city, () => true);
  } else {
    await setTextBox(
      element('label[for="P903-C0-C1-C5-C3-C1-C0-C2-C0-C1-C0-F1"]').parentElement.querySelector('input'),
      data.responseCompanyAddress.streetNumber
    );
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C1-C1-F0', data.responseCompanyAddress.postcode);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C1-C0-F0', data.responseCompanyAddress.street);
    await fillFormControl('#P903-C0-C1-C5-C3-C1-C0-C2-C0-C1-C1-F1', data.responseCompanyAddress.city);
  }
}

export async function fillProjectStep(data: NetherlandsPostingInfo) {
  if (data.performedWorkAddressType === 'None') {
    await fillProjectNone(data);
  } else {
    await fillProjectNoNone(data);
  }

  await fillProjectScheduledPeriod(data);
  await fillProjectWagePayments(data);

  await clickButton('button.btn.btn-primary.pull-right');
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

async function fillEmployee(employee: PostingInfoEmployee, data: NetherlandsPostingInfo, index: number) {
  console.log('FILL EMPLOYEE', employee, index, data);

  const additionInfo = data.employeeAdditionalInfo.find(e => e.employeeId === employee.id);

  // todo inner text is not good way to find. Consider to use better approach
  await clickButtonBy(elements('button.btn.btn-default').find(b => b.innerText === 'Add employee'));

  await fillFormRadio('@P12-C0-C0-C0-F0', 1);

  await fillFormNodeCombo(elements('.select2-container a')[0], COUNTRIES[employee.nationality]);

  await setTextBox(
    element('label[for="P12-C0-C0-C2-C1-F0"]').parentElement.querySelector('input'),
    moment(employee.dateOfBirth).format('DD-MM-YYYY')
  );
  await sleep(200);

  await fillFormControl('#P12-C0-C0-C2-C0-F0', employee.firstName);
  await fillFormControl('#P12-C0-C0-C2-C0-F2', employee.lastName);
  await fillFormControl('#P12-C0-C0-C2-C2-F0', employee.pin);
  await fillFormControl('#P12-C0-C0-C2-C3-F0', employee.email || '');

  await fillFormControl('#P12-C0-C0-C2-C2-F1', additionInfo.citizenServiceNumber);

  await sleep(200);

  const permitField = element('label[for="P12-C0-C0-C5-F4"]', true);
  if (permitField) {
    await setTextBox(
      permitField.parentElement.querySelector('input'),
      moment(additionInfo.endDateEEAWorkPermit).format('DD-MM-YYYY')
    );
  }

  if (additionInfo.certificateNumber) {
    if (!elements<HTMLInputElement>('input[name=P12-C0-C0-C7-C0-F3]')[0].checked) {
      await fillFormRadio('@P12-C0-C0-C7-C0-F3', 0);
    }
    await fillFormControl('#P12-C0-C0-C7-C0-C4-F0', additionInfo.certificateNumber);
    await fillFormNodeCombo(elements('.select2-container a')[1], COUNTRIES[additionInfo.countryOfIssue], null);
  } else {
    await fillFormRadio('@P12-C0-C0-C7-C0-F3', 1);

    await sleep(200);

    if (additionInfo.certificateApplyCountry) {
      await fillFormRadio('@P12-C0-C0-C7-C0-C5-F0', 0);
      await fillFormNodeCombo(elements('.select2-container a')[1], COUNTRIES[additionInfo.certificateApplyCountry], null);
      await fillFormNodeCombo(elements('.select2-container a')[2], COUNTRIES[additionInfo.socialContributionPaidCountry], null);
    } else {
      await fillFormRadio('@P12-C0-C0-C7-C0-C5-F0', 1);
      await fillFormNodeCombo(elements('.select2-container a')[1], COUNTRIES[additionInfo.socialContributionPaidCountry], null);
    }

    if(additionInfo.provideEvidence){
      await fillFormRadio('@P12-C0-C0-C7-C0-C5-F3', 0, null);
    }else{
      await fillFormRadio('@P12-C0-C0-C7-C0-C5-F3', 1, null);
    }
  }

  await sleep(200);

  // todo Carefully, There is possible buttons to be reordered or new to be added in feature
  const footerButtons = elements('.bq-footer button');

  await clickButtonBy(footerButtons[1]);
}

export async function fillEmployeesStep(data: NetherlandsPostingInfo, selectEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);

  for (const [index, employee] of employees.entries()) {
    await fillEmployee(employee, data, index);
  }

  // todo inner text is not good way to find. Consider to use better approach
  await clickButtonBy(elements('button.btn.btn-primary').find(b => b.innerText === 'Summary'));
}
