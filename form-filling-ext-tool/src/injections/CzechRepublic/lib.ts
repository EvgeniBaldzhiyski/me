import moment from 'moment';
import { element as defaultElement, onMutation, selectValueByText } from '../utils/dom';
import { CzechPostingAdditionalInfoEmployee, CzechPostingInfo } from './interfaces';
import { PostingInfoEmployee } from '../../utils/interfaces';

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

async function fillSelect(id: string, displayNoneId: string, value: string){
  element(id).click();
  await onMutation(document.body, () => {
    const select = element(id, true);
    return select?.tagName === 'select';
  });
  selectValueByText(id, value);
  element(id).dispatchEvent( new Event('change'));
  element(displayNoneId).style.display = 'none';
}
export async function step1(data: CzechPostingInfo) {
  if(data.postingCompanyVatNumber){
    element('#wf_txt0').value = data.postingCompanyVatNumber;
  }else{
    element('#wf_txt0').value = data.postingCompanyRegistrationNumber;
  }

  element('#wf_txt1').value = data.postingCompanyName;
  element('#wf_txt2').value = `${data.contactPerson.firstName} ${data.contactPerson.lastName}`;
  element('#wf_txt3').value = data.contactPerson.email;
  element('#wf_txt4').value = data.contactPerson.telephoneNumber;

  element('#wf_txt5').value = data.postingCompanyAddress.city;
  element('#wf_txt6').value = data.postingCompanyAddress.street;
  element('#wf_txt7').value = data.postingCompanyAddress.streetNumber.toString();
  element('#wf_txt8').value = data.postingCompanyAddress.postcode;

  await fillSelect('#wf_ilb0', '#wf_ilb0SelectBoxItOptions', data.postingCompanyAddress.country);
}

export async function step2(data: CzechPostingInfo) {
  element('#wf_txt11').value = data.hostCompanyRegistrationNumber;
  element('#wf_txt12').value = data.hostPersonBirthCertificateNumber;
  element('#wf_txt13').value = data.hostCompanyName;

  element('#wf_txt14').value = data.representativePerson.fullName;
  element('#wf_txt15').value = data.representativePerson.email;
  element('#wf_txt16').value = data.representativePerson.telephoneNumber;
  element('#wf_acm0').value = data.hostCompanyAddress.city;
  element('#wf_txt17').value = data.hostCompanyAddress.municipality;
  element('#wf_txt18').value = data.hostCompanyAddress.postcode;
  element('#wf_txt19').value = data.hostCompanyAddress.street;
  element('#wf_txt20').value = data.hostCompanyConscriptionNumber;
  element('#wf_txt21').value = data.hostCompanyAddress.streetNumber.toString();
  element('#wf_txt22').value = data.hostCompanyOrientationNumber;

  if(data.typeOfWork === 'SPECIFIED'){
    element('#wf_chb0').click();
    await onMutation(document.body, () => !!element('#wf_acm1', true));

    element('#wf_acm1').value = data.workPlaceAddress.city;
    element('#wf_txt23').value = data.workPlaceAddress.municipality;
    element('#wf_txt24').value = data.workPlaceAddress.postcode;
    element('#wf_txt25').value = data.workPlaceAddress.street;
    element('#wf_txt26').value = data.workPlaceConscriptionNumber;
    element('#wf_txt27').value = data.workPlaceAddress.streetNumber;
    element('#wf_txt28').value = data.workPlaceOrientationNumber;
  } else {
    element('#wf_chb1').click();
    await onMutation(document.body, () => !!element('#wf_txt29', true));

    element('#wf_txt29').value = data.workPlaceAddressFreeText;
  }
}

export async function step3(data: CzechPostingInfo) {
  await fillSelect('#wf_ilb1', '#wf_ilb1SelectBoxItOptions', data.postingCompanyBusinessSector.toString());
  await fillSelect('#wf_ilb2', '#wf_ilb2SelectBoxItOptions', data.typeOfWork);

  element('#wf_chb2').click();
  await onMutation(document.body, () => !!element('#wf_dat0', true));

  element('#wf_dat0').value = moment(data.startDate).format('D/M/YYYY');
  element('#wf_dat1').value = moment(data.endDate).format('D/M/YYYY');
}

export async function step4(data: CzechPostingInfo, selectedEmployeeIds: string[]) {
  let textId = 30;
  let selectId = 3;
  let checkBoxId = 5;
  const employees = prepareSelectedEmployee(data.employees, selectedEmployeeIds);
  const employeeAdditionalInfoMap: Map<string, CzechPostingAdditionalInfoEmployee> = new Map();

  for (const additionalInfo of data.employeeAdditionalInfo) {
    employeeAdditionalInfoMap.set(additionalInfo.employeeId, additionalInfo);
  }

  for(let i = 0; i < employees.length; i++){
    const employee = employees[i];

    element(`#wf_txt${textId + 1}`).value = employee.firstName;
    element(`#wf_txt${textId + 2}`).value = employee.lastName;

    await fillSelect(`#wf_ilb${selectId}`, `#wf_ilb${selectId}SelectBoxItOptions`, employee.nationality);

    if(employee.gender.toString() === '1'){
      element(`#wf_chb${checkBoxId}`).click();
    }else{
      element(`#wf_chb${checkBoxId + 1}`).click();
    }

    element('#wf_dat5').value = moment(employee.dateOfBirth).format('D/M/YYYY');
    element(`#wf_txt${textId + 3}`).value = `${employee.countryOfBirth} ${employee.townOfBirth}`;
    element(`#wf_txt${textId + 4}`).value = employeeAdditionalInfoMap.get(employee.id).identifyNumber;
    element(`#wf_txt${textId + 5}`).value = employeeAdditionalInfoMap.get(employee.id).comment;

    if(employeeAdditionalInfoMap.get(employee.id).fromEU === true){
      element(`#wf_chb${checkBoxId + 2}`).click();
    }else{
      element(`#wf_chb${checkBoxId + 3}`).click();
    }

    element(`#wf_txt${textId + 6}`).value = employee.address.city;
    element(`#wf_txt${textId + 7}`).value = employee.address.street;
    element(`#wf_txt${textId + 8}`).value = employee.address.streetNumber.toString();
    element(`#wf_txt${textId + 9}`).value = employee.address.postcode;

    await fillSelect(`#wf_ilb${selectId + 1}`, `#wf_ilb${selectId + 1}SelectBoxItOptions`, employee.address.country);

    if(employees.length > i+1){
      element('#wf_btn26').click();
      await onMutation(document.body, () => !!element(`#wf_txt${textId + 1}`, true));

      textId = textId + 9;
      checkBoxId = checkBoxId + 2;
      selectId = selectId + 2;
    }
  }
}

export function step5(data: CzechPostingInfo) {
  element('#wf_dat6').value = moment(data.dateOfIssue).format('D/M/YYYY');
}

