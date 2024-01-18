import moment from 'moment';
import { SECTORS } from './maps';
import { element as defaultElement, onMutation } from '../utils/dom';
import { fillingIsEndMessage } from '../utils/labels';
import { PostingInfoEmployee } from '../../utils/interfaces';
import { inputData } from './interfaces';
import { fillingEnd, setPostingState } from '../utils/simplify-api';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

function prepareSelectedEmployee(employees: PostingInfoEmployee[], getSelectedEmployeeIds: string[]): PostingInfoEmployee[] {
  const filteredEmployees: PostingInfoEmployee[] = [];
  const setOfSelectedEmployees = new Set(getSelectedEmployeeIds);

  for(const employee of employees) {
    if (setOfSelectedEmployees.has(employee.id)) {
      filteredEmployees.push(employee);
    }
  }

  return filteredEmployees;
}

export async function step6(data: inputData) {
  const {postingData, postingState, selectEmployeeIds} = data;
  const employeeIndex = postingState.employeeIndex || 0;
  const employees = prepareSelectedEmployee(postingData.employees, selectEmployeeIds);
  const employee = employees[employeeIndex];

  if (employee) {
    element(`#LINKED_ARBEITNEHMER.${employeeIndex}.NACHNAME`).value = employee.firstName;
    element(`#LINKED_ARBEITNEHMER.${employeeIndex}.VORNAME`).value = employee.lastName;
    element(`#LINKED_ARBEITNEHMER.${employeeIndex}.GEBURTSDATUM`).value = moment(employee.dateOfBirth).format('DD.MM.YYYY');
    element(`#LINKED_ARBEITNEHMER.${employeeIndex}.BEGINN`).value = moment(postingData.startDate).format('DD.MM.YYYY');
    element(`#LINKED_ARBEITNEHMER.${employeeIndex}.ENDE`).value = moment(postingData.endDate).format('DD.MM.YYYY');
  }

  const nextEmployee = employees[employeeIndex + 1];

  if (nextEmployee) {
    element('#lip_add-segment-instance:LINKED_ARBEITNEHMER.Default_Daten2').click();

    await onMutation(element('#lip_ScrollArea'), () => (!!element(`#LINKED_ARBEITNEHMER.${employeeIndex + 1}.ENDE`, true)));

    const statePack = {step: 6, employeeIndex: (employeeIndex + 1)};

    await setPostingState(statePack);

    void step6({ ...data,  postingState: statePack });
  } else {
    element('#B_WEITER').click();

    await onMutation(element('#lip_ScrollArea'), () => (!!element('#CB_FORMULARART_NM', true)));

    void fillingEnd(fillingIsEndMessage);
  }
}

export async function step5(data: inputData) {
  const { postingData: {recipientPerson} } = data;

  element('#ZUSTELLBEVOLL_NACHNAME').value = recipientPerson.lastName;
  element('#ZUSTELLBEVOLL_VORNAME').value =  recipientPerson.firstName;
  element('#ZUSTELLBEVOLL_STRASSE').value =  recipientPerson.address.street;
  element('#ZUSTELLBEVOLL_HAUSNUMMER').value = `${recipientPerson.address.streetNumber || ''}`;
  element('#ZUSTELLBEVOLL_POSTLEITZAHL').value =  recipientPerson.address.postcode;
  element('#ZUSTELLBEVOLL_ORT').value =  recipientPerson.address.city;

  element('#B_WEITER').click();

  await onMutation(element('#lip_ScrollArea'), () => (!!element('#LINKED_ARBEITNEHMER.0.ENDE', true)));

  await setPostingState({step: 6});
  void step6(data);
}

export async function step4(data: inputData) {
  const { postingData: { contactPerson }} = data;

  console.log('step4');

  element('#ANSPRECHPARTNER_NACHNAME').value =  contactPerson.lastName;
  element('#ANSPRECHPARTNER_VORNAME').value =  contactPerson.firstName;
  element('#ANSPRECHPARTNER_GEBURTSDATUM').value =  moment(contactPerson.dateOfBirth).format('DD.MM.YYYY');
  element('#ANSPRECHPARTNER_STRASSE').value = contactPerson.address.street;
  element('#ANSPRECHPARTNER_HAUSNUMMER').value =  `${contactPerson.address.streetNumber || ''}`;
  element('#ANSPRECHPARTNER_POSTLEITZAHL').value =  contactPerson.address.postcode;
  element('#ANSPRECHPARTNER_ORT').value =  contactPerson.address.city;

  element('#B_WEITER').click();

  await onMutation(element('#lip_ScrollArea'), () => (!!element('#ZUSTELLBEVOLL_ORT', true)));

  await setPostingState({step: 5});
  void step5(data);
}

export async function step3(data: inputData) {
  const {postingData: { documentPerson }} = data;

  element('#UNTERLAGEN_NACHNAME').value = documentPerson.lastName;
  element('#UNTERLAGEN_VORNAME').value = documentPerson.firstName;
  // element('#UNTERLAGEN_FIRMA').value = documentPerson.organizationName;
  element('#UNTERLAGEN_STRASSE').value = documentPerson.address.street;
  element('#UNTERLAGEN_HAUSNUMMER').value = `${documentPerson.address.streetNumber || ''}`;
  element('#UNTERLAGEN_POSTLEITZAHL').value = documentPerson.address.postcode;
  element('#UNTERLAGEN_ORT').value = documentPerson.address.city;

  element('#B_WEITER').click();

  await onMutation(element('#lip_ScrollArea'), () => (!!element('#ANSPRECHPARTNER_ORT', true)));

  await setPostingState({step: 4});
  void step4(data);
}

export async function step2(data: inputData) {
  const { postingData } = data;

  element('#BESCH_BRANCHE').value = (SECTORS[postingData.hostStateCountryBusinessSector.description] || 'No information');
  element('#BESCH_STRASSE').value = postingData.hostCompanyAddress.street;
  element('#BESCH_HAUSNUMMER').value = postingData.hostCompanyAddress.streetNumber.toString();
  element('#BESCH_POSTLEITZAHL').value = postingData.hostCompanyAddress.postcode;
  element('#BESCH_ORT').value = postingData.hostCompanyAddress.city;

  element('#BESCH_BEGINN').value = moment(postingData.startDate).format('DD.MM.YYYY');
  element('#BESCH_ENDE').value = moment(postingData.endDate).format('DD.MM.YYYY');

  element('#B_WEITER').click();

  await onMutation(element('#lip_ScrollArea'), () => (!!element('#UNTERLAGEN_ORT', true)));

  await setPostingState({step: 3});
  void step3(data);
}

export async function step1(data: inputData) {
  element('#B_WEITER').click();

  await onMutation(element('#lip_ScrollArea'), () => (!!element('#BESCH_BRANCHE', true)));

  await setPostingState({step: 2});
  void step2(data);
}

export async function step0(data: inputData) {
  const radioButton = element('#LB_CB_FORMULARART_NM', true);

  if (!radioButton) {
    return;
  }

  radioButton.click();

  await onMutation(element('#lip_ScrollArea'), () => (
    !!element('#lip_segment-instance:Seite1:body:Default_Daten2', true) &&
    !!element('#lip_segment-instance:Seite1:body:Default_Daten4', true)
  ));

  await setPostingState({step: 1});
  void step1(data);
}
