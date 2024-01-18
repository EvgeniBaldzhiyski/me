import moment from 'moment';
import { element as defaultElement, elements, onMutation, selectValueByText } from '../utils/dom';
import { CONTACT_PERSON_QUALITY, COUNTRIES, GENDER, IDENTIFY_NUMBER_TYPE } from './maps';
import { PostingInfo, PostingInfoEmployee } from '../../utils/interfaces';
import { setPostingState } from '../utils/simplify-api';
import { PortugalPostingInfo } from './interfaces';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

function postcode(belgiumInputFieldId, postalCodeInputFieldId, code, city, postalCodeLabelFieldId) {
  const belgiumInputField = element(`#${belgiumInputFieldId}`, true);

  if (belgiumInputField) {
    const value = selectValueByText(`#${belgiumInputFieldId}`, `${code} - ${city}`);

    if (postalCodeLabelFieldId) {
      element(`#${postalCodeLabelFieldId}`).value = value;
    }
  } else {
    element(`#${postalCodeInputFieldId}`).value = code;
  }
}

export async function run(info: PostingInfo) {
  if (info.postingCompanyVatNumber) {
    element('#vatEmployer:0').click();

    await onMutation(element('#employerStepForm'));

    selectValueByText('#employerVatCountryCriteria_input', COUNTRIES[info.postingCompanyAddress.country]);
    element('#employerVatCountryCriteria_label').innerText = COUNTRIES[info.postingCompanyAddress.country];

    element('#vatNumberSearchCriteria').value = info.postingCompanyVatNumber;

    await setPostingState({ step: 0 });

    element('#searchByVatButton').click();
  } else {
    await setPostingState({ step: 1 });

    element('#newEnterpriseButton').click();
  }
}

export async function runStep0() {
  await setPostingState({ step: 1 });

  const chose = element('#moralActorResultTable:0:displayDetailLink', true);
  if (!chose) {
    element('#newEnterpriseButton').click();
  } else {
    chose.click();
  }
}

export async function runStep1(info: PostingInfo) {
  // @TODO is missing info
  element('#interimRadio:1').click();

  const vat = element('#vatNumber', true);
  if (!vat) {
    element('#tradingName').value = info.postingCompanyName;
    element('#noVatJustification').value = info.vatMissingExplanation;

    selectValueByText('#addressCountry', COUNTRIES[info.postingCompanyAddress.country]);
    element('#addressCountry').dispatchEvent(new Event('change'));

    await onMutation(
      element('#moralActorDetailForm'),
      () => !!element('#postalCode', true) || !!element('#belgianPostalCode_input', true)
    );

    element('#street').value = info.postingCompanyAddress.street;
    element('#streetNumber').value = `${info.postingCompanyAddress.streetNumber || ''}`;
    // @TODO is missing info
    element('#box').value = (info.postingCompanyAddress.box || '');

    postcode(
      'belgianPostalCode_input',
      'postalCode',
      info.postingCompanyAddress.postcode,
      info.postingCompanyAddress.city,
      'belgianPostalCode_label'
    );

    (element('#municipality', true) || {} as HTMLInputElement).value = info.postingCompanyAddress.city;
  }

  await setPostingState({ step: 2 });

  element('#saveEmployerButton').click();
}

export async function runStep2() {
  await setPostingState({ step: 3 });

  element('#nextStepFromEmployerButton').click();
}

export async function runStep3(info: PostingInfo) {
  element('#firstName').value = info.contactPerson.firstName;
  element('#lastName').value = info.contactPerson.lastName;

  const birthDate = new Date(+info.contactPerson.dateOfBirth);
  element('#birthDateDay').value = String(birthDate.getDate());
  element('#birthDateMonth').value = String(birthDate.getMonth() + 1);
  element('#birthDateYear').value = String(birthDate.getFullYear());

  selectValueByText('#nationalities', COUNTRIES[info.contactPerson.nationality]);

  selectValueByText('#addressCountry', COUNTRIES[info.contactPerson.address.country || info.contactPerson.nationality]);
  element('#addressCountry').dispatchEvent(new Event('change'));

  await onMutation(
    element('#liaisonPersonForm'),
    () => !!element('#postalCode', true) || !!element('#belgianPostalCode_input', true)
  );

  element('#street').value = info.contactPerson.address.street;
  element('#streetNumber').value = `${info.postingCompanyAddress.streetNumber || ''}`;
  // @TODO is missing info
  element('#box').value = info.contactPerson.address.box || '';

  postcode(
    'belgianPostalCode_input',
    'postalCode',
    info.contactPerson.address.postcode,
    info.contactPerson.address.city,
    'belgianPostalCode_label'
  );

  (element('#municipality', true) || {} as HTMLInputElement).value = info.contactPerson.address.city;

  // @NOTE these both fields are placed incorrectly in address section
  element('#phone').value = info.contactPerson.address.telephone;
  element('#email').value = info.contactPerson.address.email;

  const qualities = elements('#liaisonQualityType label');
  for (const quality of qualities) {
    if (quality.innerText.trim() === CONTACT_PERSON_QUALITY[info.contactPerson.professionalQualification]) {
      element(`#${quality.getAttribute('for')}`).click();
      break;
    }
  }

  await setPostingState({ step: 4 });

  element('#nextStepButton').click();
}

export async function runStep4(info: PostingInfo) {
  const address = info.worksiteAddress.addressDto;

  if (address.postcode) {
    if (address.municipality) {
      await setPostingState({ step: 5, phase: 2 });

      element('#addBuildingSiteLink').click();
    } else {
      await setPostingState({ step: 5, phase: 1 });

      element('#addTeleworkLink').click();
    }
    return;
  }

  await setPostingState({ step: 5, phase: 0 });

  element('#addCompanyLink').click();
}

export async function runStep50(info: PostingInfo) {
  if (info.hostCompanyCBENumber) {
    element('#kboNumber').value = info.hostCompanyCBENumber;

    await setPostingState({ step: 6 });

    element('#searchByKboNumberButton').click();
    return;
  }

  if (info.hostCompanyNOSSNumber) {
    element('#nossNumber').value = info.hostCompanyNOSSNumber;

    await setPostingState({ step: 6 });

    element('#searchByNossButton').click();
    return;
  }

  const select = element('#belgianPostalCode_input') as unknown as HTMLSelectElement;
  select.value = (select.options[1] || {}).value;

  element('#tradingName').value = 'Host company name';

  await setPostingState({ step: 6 });

  element('#searchCompanyButton').click();
}

export async function runStep51(info: PostingInfo) {
  element('#privateAddress:0').click();

  const address = info.worksiteAddress.addressDto;

  element('#street').value = address.street;
  element('#streetNumber').value = address.streetNumber.toString();
  // @TODO is missing info
  element('#box').value = (address.box || '');

  postcode('belgianPostalCode_input', 'postalCode', address.postcode, address.city, 'belgianPostalCode_label');

  await setPostingState({ step: 7 });

  element('#createUpdateTeleworkSiteButton').click();
}

export async function runStep52(info: PostingInfo) {
  const address = info.worksiteAddress.addressDto;

  element('#name').value = address.municipality;
  element('#street').value = address.street;
  element('#streetNumber').value = address.streetNumber.toString();
  // @TODO is missing info
  element('#box').value = (address.box || '');

  postcode('belgianPostalCode_input', 'postalCode', address.postcode, address.city, 'belgianPostalCode_label');

  await setPostingState({ step: 7 });

  element('#createUpdateBuildingSiteButton').click();
}

export async function runStep6(info: PostingInfo) {
  element('#name').value = info.hostCompanyName;

  (element('#companyId', true) || {} as HTMLInputElement).value = info.hostCompanyCBENumber;
  (element('#noss', true) || {} as HTMLInputElement).value = info.hostCompanyNOSSNumber;

  element('#street').value = info.hostCompanyAddress.street;
  element('#streetNumber').value = info.hostCompanyAddress.streetNumber.toString();
  element('#box').value = (info.hostCompanyAddress.box || '');

  postcode(
    'belgianPostalCode_input',
    'postalCode',
    info.hostCompanyAddress.postcode,
    info.hostCompanyAddress.city,
    'belgianPostalCode_label'
  );

  element('#mail').value = info.emailContact;
  element('#phoneNumber').value = (info.hostCompanyAddress.telephone || '');
  element('#faxNumber').value = (info.hostCompanyAddress.fax || '');

  await setPostingState({ step: 7 });

  element('#createUpdateCompany').click();
}

export async function runStep7() {
  // await setPostingState({ step: 8 });
  await setPostingState({ step: 10 });

  element('#nextStepFromPOWButton').click();
}

export async function runStep8() {
  await setPostingState({ step: 9 });

  (
    element('#stepBelgianClientForm:powAsClientLink', true) ||
    element('#stepBelgianClientForm:newClientLink', true)
  ).click();
}

export async function runStep9() {
  await setPostingState({ step: 10 });

  element('#powListAsClientTable:0:addPowAsClientLink').click();
}

export async function runStep10() {
  await setPostingState({ step: 11 });

  element('#stepBelgianClientForm:nextStepFromBelgianClientButton').click();
}

export async function runStep11(info: PostingInfo) {
  element('#startDate_input').value = moment(+info.startDate).format('DD/MM/YYYY');
  element('#endDate_input').value = moment(+info.endDate).format('DD/MM/YYYY');

  selectValueByText('#activity', info.hostStateCountryBusinessSector.description as string);

  await setPostingState({ step: 12 });

  element('#nextStepButton').click();
}

export function prepareSelectedEmployee(employees: PostingInfoEmployee[], getSelectedEmployeeIds: string[]): PostingInfoEmployee[] {
  const filteredEmployees: PostingInfoEmployee[] = [];
  const setOfSelectedEmployees = new Set(getSelectedEmployeeIds);

  for(const employee of employees) {
    if (setOfSelectedEmployees.has(employee.id)) {
      filteredEmployees.push(employee);
    }
  }

  return filteredEmployees;
}

export async function runStep12(info: PortugalPostingInfo, employeeIndex: number, getSelectedEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(info.employees, getSelectedEmployeeIds);

  const employee = employees[employeeIndex];

  if (employee) {
    await setPostingState({ step: 13, employeeIndex });

    element('#newEmployeeLink').click();
  } else {
    await setPostingState({ step: 14 });

    element('#nextStepButton').click();
  }
}

export async function runStep13(info: PortugalPostingInfo, employeeIndex: number, getSelectedEmployeeIds: string[]) {
  const employees = prepareSelectedEmployee(info.employees, getSelectedEmployeeIds);

  const employee = employees[employeeIndex];

  element('#lastName').value = employee.lastName;
  element('#firstName').value = employee.firstName;

  const genderStrings = elements('#genderString label');
  for (const genderString of genderStrings) {
    if (genderString.innerText.trim() === GENDER[employee.gender]) {
      element(`#${genderString.getAttribute('for')}`).click();
      break;
    }
  }

  const birthDate = new Date(+employee.dateOfBirth);
  element('#birthDateDay').value = String(birthDate.getDate());
  element('#birthDateMonth').value = String(birthDate.getMonth() + 1);
  element('#birthDateYear').value = String(birthDate.getFullYear());

  selectValueByText('#nationalities', COUNTRIES[employee.nationality]);

  selectValueByText('#phoneticAddressaddressCountry', COUNTRIES[employee.address.country]);
  element('#phoneticAddressaddressCountry').dispatchEvent(new Event('change'));

  await onMutation(
    element('#employerSearchForm'),
    () => !!element('#phoneticAddresspostalCode', true) || !!element('#phoneticAddressbelgianPostalCode_input', true)
  );

  element('#phoneticAddressstreet').value = employee.address.street;
  element('#phoneticAddressstreetNumber').value = `${employee.address.streetNumber || ''}`;
  // @TODO is missing info
  element('#phoneticAddressbox').value = (employee.address.box || '');

  postcode(
    'phoneticAddressbelgianPostalCode_input',
    'phoneticAddresspostalCode',
    employee.address.postcode,
    employee.address.city,
    'phoneticAddressbelgianPostalCode_label'
  );

  element('#phoneticAddressmunicipality', true).value = employee.address.city;

  for(const _employee of info.employeeAdditionalInfo) {
    if (_employee.employeeId === employee.id) {
      selectValueByText('#phoneticForeignNumberTypeString', IDENTIFY_NUMBER_TYPE[_employee.identifyNumberType as string]);
      element('#phoneticForeignNumber').value = _employee.identifyNumber;

      selectValueByText('#phoneticForeignNumberCountryString', COUNTRIES[_employee.identificationCountry]);
      break;
    }
  }

  await setPostingState({ step: 12, employeeIndex: (employeeIndex + 1) });

  element('#searchByPhoneticalDataButton').click();
}

export async function runStep14() {
  await setPostingState({ step: 15 });

  element('#stepTimeTableForm:choice1Link').click();
}

export async function runStep15(info: PostingInfo) {
  let splitTime = [];

  splitTime = info.workStartTimeBeforeBreak.split(':');
  element('#stepTimeTableForm:j_idt70').value = splitTime[0];
  element('#stepTimeTableForm:j_idt72').value = splitTime[1];

  splitTime = info.workEndTimeBeforeBreak.split(':');
  element('#stepTimeTableForm:j_idt75').value = splitTime[0];
  element('#stepTimeTableForm:j_idt77').value = splitTime[1];

  splitTime = info.workStartTimeAfterBreak.split(':');
  element('#stepTimeTableForm:j_idt80').value = splitTime[0];
  element('#stepTimeTableForm:j_idt82').value = splitTime[1];

  splitTime = info.workEndTimeAfterBreak.split(':');
  element('#stepTimeTableForm:j_idt85').value = splitTime[0];
  element('#stepTimeTableForm:j_idt87').value = splitTime[1];

  selectValueByText('#stepTimeTableForm:fromDayWeek1', info.fromDayWeek as string);
  selectValueByText('#stepTimeTableForm:toDayWeek1', info.toDayWeek as string);
  selectValueByText('#stepTimeTableForm:exceptDayWeek1', info.exceptDayWeek as string);

  await setPostingState({ step: 16 });

  element('#stepTimeTableForm:generateScheduleButton').click();
}

export async function runStep16() {
  await setPostingState({ step: 17 });

  element('#stepTimeTableForm:confirmTimeScheduleLink').click();
}

export async function runStep17() {
  await setPostingState({ step: 18 });

  element('#stepTimeTableForm:nextStepButton').click();
}
