import moment from 'moment';
import { PostingInfoAddress } from '../../utils/interfaces';
import { element as defaultElement, elements, fillFormFile, fillFormText, onMutation, selectValueByTextByNode } from '../utils/dom';
import { PolishPostingInfo } from './interfaces';
import {
  COUNTRIES,
  ContactDetailsPageSections,
  DocumentsSections,
  EmployerPageSections,
  PostedWorkersSections,
  SubmissionPageSections,
  TextToCompare } from './maps';
import config from '../../utils/config';

function element<R extends HTMLInputElement | HTMLSelectElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

function addressToSet(data: PostingInfoAddress) {
  return `${data.street} ${data.streetNumber}`;
}

function postCodeFormat(postcode: string) {
  return postcode.replace(/^(.{2})(.{3})/, '$1-$2');
}


function setSelectFieldByText(selector: string, match: string){
  const el = element<HTMLSelectElement>(selector);

  selectValueByTextByNode(el, match);

  el.dispatchEvent(new Event('change'));
  el.dispatchEvent(new Event('blur'));
}

async function setPostCompanyAddress(data: PostingInfoAddress){
  const {country, district, city, postcode} = data;
  setSelectFieldByText( '#composite-addres1-subflow-simple-address1-select-panel1', COUNTRIES[country]);
  await onMutation(document.body, () => !!element('#composite-addres1-subflow-simple-address1-zipCodeForeign', true));
  fillFormText('#composite-addres1-subflow-simple-address1-street1Foreign', addressToSet(data));
  fillFormText('#composite-addres1-subflow-simple-address1-input9Foreign', city);
  fillFormText('#composite-addres1-subflow-simple-address1-provinceForeign', district);
  fillFormText('#composite-addres1-subflow-simple-address1-zipCodeForeign', postcode);
}

function getElementByInnerText(node: HTMLElement[], match: string, strictMatch?: boolean){
  return Array.from(node).find(b => (strictMatch ? b.innerText === match : b.innerText.includes(match)));
}

export async function fillSubmittingPersonStep(data: PolishPostingInfo) {
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => element('legend', true).innerText === TextToCompare.SELECT_PROFILE);
  const allCompanies = elements('label span');
  const companyToChoose = getElementByInnerText(allCompanies, data.postingCompanyName, true);
  if (companyToChoose) {
    companyToChoose.click();
  } else {
    allCompanies[allCompanies.length-1].click();
  }
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => (
    elements('label span', true)[SubmissionPageSections.IN_PERSON]?.innerText === TextToCompare.IN_PERSON
  ));
  if (!data.attorneyPowerId) {
    elements('label span')[SubmissionPageSections.IN_PERSON].click();
    element('button.btn.btn-primary').click();
    await onMutation(document.body, () => !!element('#header3', true));
  } else {
    elements('label span')[SubmissionPageSections.ATTORNEY_IN_FACT].click();
    await onMutation(document.body, () => !!element('button.btn.box-icon-btn', true));
    element('button.btn.box-icon-btn', true).click();
    fillFormText('#fileDescription', TextToCompare.ATTORNEY_POWER);
    await fillFormFile(element<HTMLInputElement>('#fileSelect'), data.attorneyPowerId);
    elements('button.btn.btn-primary')[SubmissionPageSections.ADD].click();
    await onMutation(document.body, () => !!element('i', true));

    element('button.btn.btn-primary').click();
    await onMutation(document.body, () => !!element('#composite-simple1-zipCodeForeign', true));
  }
}

export async function fillAttorneyInFactStep(data: PolishPostingInfo) {
  if (!data?.attorneyPowerId) {
    return;
  }
  fillFormText('#input1', data.documentPerson.firstName);
  fillFormText('#input2', data.documentPerson.lastName);
  setSelectFieldByText( '#composite-simple1-select-panel1', COUNTRIES[data.documentPerson.address.country]);
  fillFormText('#composite-simple1-street1Foreign', addressToSet(data.documentPerson.address));
  fillFormText('#composite-simple1-input9Foreign', data.documentPerson.address.city);
  fillFormText('#composite-simple1-provinceForeign', data.documentPerson.address.district);
  fillFormText('#composite-simple1-zipCodeForeign', data.documentPerson.address.postcode);

  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('#header3', true));
}

export async function fillEmployerStep(data: PolishPostingInfo) {
  const labelSpans = elements('label span');
  fillFormText('#input1', data.postingCompanyName);
  if (element('#input2', true)) {
    labelSpans[EmployerPageSections.NO_NIP].click();
  }
  fillFormText('#input3', data.postingCompanyRegistrationNumber);
  if (data.reasonForPosting === TextToCompare.UNDER_CONTRACT) {
    labelSpans[EmployerPageSections.UNDER_CONTRACT].click();
  } else {
    labelSpans[EmployerPageSections.INTRA_GROUP].click();
  }
  const addressToChoose = getElementByInnerText(elements('span.item-content'), addressToSet(data.postingCompanyAddress));
  if (addressToChoose) {
    addressToChoose.click();
  } else {
    element('span.item-content', true).click();
    await onMutation(document.body, () => !!element('#composite-addres1-subflow-simple-address1', true));
    await setPostCompanyAddress(data.postingCompanyAddress);
    element('button.btn.btn-primary').click();
    await onMutation(document.body, () => !!elements('label span')[EmployerPageSections.ADDRESS]);
    elements('label span')[EmployerPageSections.ADDRESS].click();
  }

  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('#section2', true));
}

export async function fillContactDetailsStep(data: PolishPostingInfo) {
  fillFormText('#input1', data.postingCompanyAddress.telephone);
  fillFormText('#input2', data.postingCompanyAddress.email);

  if (data?.postCompanyCorrespondenceAddress) {
    element('input[name = "checkbox1"]', true).click();
    elements('i')[ContactDetailsPageSections.NEW_ADDRESS].click();
    await onMutation(document.body, () => !!element('#composite-addres1-subflow-simple-address1', true));
    await setPostCompanyAddress(data.postCompanyCorrespondenceAddress);
    element('button.btn.btn-primary').click();
    await onMutation(document.body, () => elements('label span', true).length > 1);
    getElementByInnerText(elements('label span'), addressToSet(data.postCompanyCorrespondenceAddress), true).click();
  }
  element('button.btn.btn-primary').click();
  if (data?.attorneyPowerId) {
    await onMutation(document.body, () => !!element('#section1', true));
  } else {
    await onMutation(document.body, () => !!element('#input4', true));
  }
}

export async function fillSubmittingPersonDataStep(data: PolishPostingInfo) {
  if (data.attorneyPowerId) {
    return;
  }
  fillFormText('#input4', data.documentPerson.firstName);
  fillFormText('#input5', data.documentPerson.lastName);
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('#section1', true));
}

export async function fillInformationOfPostingStep(data: PolishPostingInfo) {
  fillFormText('#input1', data.employees.length as unknown as string);
  fillFormText('#date-picker1', moment(data.startDate).format('YYYY-MM-DD'));
  fillFormText('#date-picker2', moment(data.endDate).format('YYYY-MM-DD'));
  fillFormText('#input4', data.postingCompanyBusinessSector.description);
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('button.btn.box-icon-btn', true));
}

export async function fillPostedWorkersStep(data: PolishPostingInfo, selectEmployeeIds: string[]){
  element('button.btn.box-icon-btn', true).click();
  fillFormText('#fileDescription', TextToCompare.EMPLOYEES);
  await fillFormFile(
    element<HTMLInputElement>('#fileSelect', true),
    {method: 'get', url: `${config.get('api.links.filePolishPDF')}${data.ismId}/?employeeIds=${selectEmployeeIds}`},
    'filePolishPDF.pdf'
  );
  elements('button.btn.btn-primary')[PostedWorkersSections.ADD].click();
  await onMutation(document.body, () => elements('i', true).length > 1);
  element('button.btn.btn-primary').click();
  if (!element('#section3', true)) {
    await onMutation(document.body, () => !!element('#section3', true));
  }
}

export async function fillContactPersonStep(data: PolishPostingInfo){
  fillFormText('#input1', data.contactPerson.firstName);
  fillFormText('#input2', data.contactPerson.lastName);
  fillFormText('#composite-simple1-zipCode', postCodeFormat(data.contactPerson.address.postcode));
  await onMutation(document.body, () => element('#composite-simple1-input9', true)?.value === '');
  fillFormText('#composite-simple1-input9', data.contactPerson.address.city);
  await onMutation(document.body, () => true);
  setSelectFieldByText('#composite-simple1-select-panel3', TextToCompare.STREET);
  await onMutation(document.body, () => true);
  fillFormText('#composite-simple1-input5', data.contactPerson.address.street);
  fillFormText('#composite-simple1-input6', data.contactPerson.address.streetNumber as unknown as string);
  fillFormText('#input3', data.contactPerson.address.telephone);
  fillFormText('#input4', data.contactPerson.address.email);
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('#select-panel1', true));
}

export async function fillDocumentsStep(data: PolishPostingInfo){
  const labelSpans = elements('label span');
  if (!data?.documentsKeepingAddress) {
    labelSpans[DocumentsSections.CONTACT_LOCATION].click();
    await onMutation(document.body, () => !!element('#richtext2', true));
  } else {
    labelSpans[DocumentsSections.DIFFERENT_LOCATION].click();
    await onMutation(document.body, () => !!element('#section2', true));
    fillFormText('#input1', data.nameOfDocumentsKeepingLocation);
    fillFormText('#composite-simple1-zipCode', postCodeFormat(data.documentsKeepingAddress.postcode));
    await onMutation(document.body, () => element('#composite-simple1-input9', true)?.value === '');
    fillFormText('#composite-simple1-input9', data.documentsKeepingAddress.city);
    await onMutation(document.body, () => true);
    setSelectFieldByText('#composite-simple1-select-panel3', TextToCompare.STREET);
    await onMutation(document.body, () => true);
    fillFormText('#composite-simple1-input5', data.documentsKeepingAddress.street);
    fillFormText('#composite-simple1-input6', data.documentsKeepingAddress.streetNumber as unknown as string);
  }
  element('button.btn.btn-primary').click();
  await onMutation(document.body, () => !!element('#select-panel11', true));
}
