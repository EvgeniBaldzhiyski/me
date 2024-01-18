import moment from 'moment';
import { PostingInfoEmployee } from '../../utils/interfaces';
import {
  element,
  elements,
  fillFormFile,
  fillFormText,
  onMutation,
  selectValueByTextByNode,
  sleep,
} from '../utils/dom';
import { DenmarkPostingAdditionalInfoEmployee, DenmarkPostingInfo } from './interfaces';
import { COUNTRIES, PAGES, TYPE_OF_ID } from './maps';
import { setPostingState } from '../utils/simplify-api';

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

function fillFormNodeCombo(selector: string, match: string, mode: 'regex' | 'strictMatch' | 'include' = 'strictMatch'): string {
  const el = element<HTMLSelectElement>(selector);

  const value = selectValueByTextByNode(el, match, mode);

  el.dispatchEvent(new Event('change'));

  return value;
}

async function fillFormAutoComplete(selector: string, value: string) {
  const el = element<HTMLInputElement>(selector);

  el.value = value;
  el.dispatchEvent(new Event('input'));
  await sleep(300);
}

function fillFormSelectByValue(selector: string, value: string) {
  const el = element<HTMLInputElement>(selector);

  el.value = value;
  el.dispatchEvent(new Event('change'));
}

function splitNum(num: string, pos: number) {
  return [num.substring(0, pos), num.substring(pos)];
}

function isPageActive(page: PAGES): boolean {
  const links = elements('ul.nav li.ok-nav');

  return links[page].className.includes('active');
}

function goTo(page: PAGES) {
  elements('ul.nav li.ok-nav')[page].click();
}

async function clickAndWait(selector: string, sleepDuration = 200) {
  element(selector).click();

  await sleep(sleepDuration);
}

export async function fillCompanyAndSectorStep(data: DenmarkPostingInfo) {
  if (!isPageActive(PAGES.COMPANY_AND_SECTOR)) {
    return goTo(PAGES.COMPANY_AND_SECTOR);
  }

  element('a[href="#opretvirksomhedModal"]').click();

  await onMutation(document.body, () => !!element('#virksomhed.virksomhedsnavn', true));

  fillFormText('#virksomhed.virksomhedsnavn', data.postingCompanyName);

  fillFormNodeCombo('#virksomhed.udenlandskAdresse.land', COUNTRIES[data.postingCompanyAddress.country]);

  fillFormText('#virksomhed.udenlandskAdresse.adresselinje1', (
    `${data.postingCompanyAddress.street} ${data.postingCompanyAddress.streetNumber}`
  ));
  fillFormText('#virksomhed.udenlandskAdresse.postnummer', data.postingCompanyAddress.postcode);
  fillFormText('#virksomhed.udenlandskAdresse.bynavn', data.postingCompanyAddress.city);
  fillFormText('#virksomhed.udenlandskAdresse.omraade', data.postingCompanyAddress.district);
  fillFormText('#virksomhed.telefon.telefonLandekode', splitNum(data.postingCompanyAddress.telephone, 4)[0]);
  fillFormText('#virksomhed.telefon.telefonnummer', splitNum(data.postingCompanyAddress.telephone, 4)[1]);
  fillFormText('#virksomhed.email', data.postingCompanyAddress.email);
  fillFormText('#virksomhed.bekraeftemail', data.postingCompanyAddress.email);

  fillFormNodeCombo('#virksomhed.naceKode', data.postingCompanyBusinessSector.code, 'include');

  await clickAndWait('#virksomhed.virksomhedstype_VMA');
  await clickAndWait('#virksomhed.harReelleAktiviteter_ja');

  if (data.postingCompanyVatNumber) {
    await clickAndWait('#virksomhed.harMomsnummer_ja');

    fillFormText('#virksomhed.momsnummer', data.postingCompanyVatNumber);
    fillFormText('#virksomhed.momsregistreringssted', COUNTRIES[data.postingCompanyAddress.country]);
  } else {
    await clickAndWait('#virksomhed.harMomsnummer_nej');
  }

  fillFormText('#virksomhed.registreringsnummer', data.postingCompanyRegistrationNumber);
  fillFormText('#virksomhed.registreringssted', COUNTRIES[data.postingCompanyAddress.country]);

  if(COUNTRIES[data.postingCompanyAddress.country] === 'Denmark') {
    fillFormText('#cvrsenummer', data.postingCompanyRegistrationNumber);
  }

  element('input.submit').click();
  await onMutation(document.body, () => !!element(' #virksomhedsinformation .alert-info', true));

  await clickAndWait('#ydelse.virksomhedstype_VMA');

  fillFormNodeCombo('#naceKodeDropdown', data.hostCompanyBusinessSector.code, 'include');

  await clickAndWait('#ydelse.hvervgivertype_VIRKSOMHED');

  fillFormText('#ydelse.hvervgiverCvr', data.hostCompanyRegistrationNumber);
  fillFormText('#ydelse.hvervgiverKontaktperson', data.contactPerson.fullName);

  await sleep(1000);
  await setPostingState({ step: 1 });
  element('@_action_validerVirksomhed').click();
}

async function fillEmployee(employee: PostingInfoEmployee, additionalInfo: DenmarkPostingAdditionalInfoEmployee) {
  fillFormText('#person.fornavn', employee.firstName);
  fillFormText('#person.efternavn', employee.lastName);

  if ((employee.gender as unknown as string) === '2') {
    element('#person.koen_KVINDE').click();
  } else {
    element('#person.koen_MAND').click();
  }

  fillFormNodeCombo('#person.statsborgerskab', COUNTRIES[employee.nationality]);

  fillFormSelectByValue('#person.personIdType', TYPE_OF_ID[additionalInfo.identifyNumberType]);

  fillFormText('#person.personIdentifikation', additionalInfo.identifyNumber);

  fillFormText('#person.foedselsdato', moment(employee.dateOfBirth).format('YYYY-MM-DD'));

  fillFormText('#person.telefon.telefonLandekode', splitNum(employee.telephoneNumber, 4)[0]);
  fillFormText('#person.telefon.telefonnummer', splitNum(employee.telephoneNumber, 4)[1]);
  fillFormText('#person.email', employee.email);

  fillFormNodeCombo('#person.socialSikringLand', COUNTRIES[employee.address.country]);

  if (additionalInfo.a1CertificateId) {
    await clickAndWait('#person.udstedtA1_ja');

    await fillFormFile(element<HTMLInputElement>('#a1fileupload'), additionalInfo.a1CertificateId as unknown as string);
  } else {
    await clickAndWait('#person.udstedtA1_nej');

    if (additionalInfo.a1ApplicationDocumentId) {
      await clickAndWait('#person.ansoegtA1_ja');

      await fillFormFile(element<HTMLInputElement>('#a1fileupload'), additionalInfo.a1ApplicationDocumentId as unknown as string);
    } else {
      await clickAndWait('#person.ansoegtA1_nej');
    }
  }

  if (additionalInfo.declarationOfQualificationId) {
    await clickAndWait('#person.indsendtForhaandserklaering_ja');

    await fillFormFile(
      element<HTMLInputElement>('#forhaandserklaeringfileupload'),
      additionalInfo.declarationOfQualificationId as unknown as string);
  } else {
    await clickAndWait('#person.indsendtForhaandserklaering_nej');
  }

  element('input.submit').click();
}

export async function fillEmployeesStep(data: DenmarkPostingInfo, selectEmployeeIds: string[]) {
  if (!isPageActive(PAGES.EMPLOYEES)) {
    return goTo(PAGES.EMPLOYEES);
  }

  const employees = prepareSelectedEmployee(data.employees, selectEmployeeIds);
  const employeeAdditionalInfo: Map<string, DenmarkPostingAdditionalInfoEmployee> = new Map();

  for (const additionalInfo of data.employeeAdditionalInfo) {
    employeeAdditionalInfo.set(additionalInfo.employeeId, additionalInfo);
  }

  for (const [index, employee] of employees.entries()) {
    element('a[href="#opretpersonModal"]').click();

    await onMutation(document.body, () => !!element('#uploadForhaand', true));

    await fillEmployee(employee, employeeAdditionalInfo.get(employee.id));

    await onMutation(document.body, () => elements('.personPeriodeBoks', true)?.length === (index + 1));

    await sleep(300);

    fillFormText('#ydelse.personPerioder[0].gyldigFra', moment(data.startDate).format('YYYY-MM-DD'));
    fillFormText('#ydelse.personPerioder[0].gyldigTil', moment(data.endDate).format('YYYY-MM-DD'));

    if (employee.id === data.postCompanyContactPersonId) {
      await sleep(300);
      await clickAndWait('#ydelse.personPerioder[0].kontaktperson', 400);
      fillFormText('#ydelse.personPerioder[0].kontaktFra', moment(data.startDate).format('YYYY-MM-DD'));
      fillFormText('#ydelse.personPerioder[0].kontaktTil', moment(data.endDate).format('YYYY-MM-DD'));
    }
  }

  await sleep(1000);
  await setPostingState({ step: 2 });
  element('@_action_validerPerson').click();
}

export async function fillWorkplaceStep(data: DenmarkPostingInfo) {
  if (!isPageActive(PAGES.WORKPLACE)) {
    return goTo(PAGES.WORKPLACE);
  }

  element('a[href="#opretarbejdsstedModal"]').click();

  await onMutation(document.body, () => !!element('#arbejdssted.danskAdresse.adresse', true));

  fillFormText('#arbejdssted.navn', data.workplaceName);

  const {city, postcode, street, streetNumber} = data.workplaceAddress;
  await fillFormAutoComplete('#arbejdssted.danskAdresse.adresse', `${street} ${streetNumber}, ${postcode} ${city}`);

  await onMutation(element('#adresseStatus'), () => element('#adresse').innerText === `${street} ${streetNumber}, ${postcode} ${city}`);

  fillFormText('#arbejdssted.danskAdresse.etage', data.workplaceAddressFloor);
  fillFormText('#arbejdssted.danskAdresse.sidedoer', data.workplaceAddressDoor);

  element('input.submit').click();
  await onMutation(document.body, () => !!element('#ydelse.arbejdsstedsPerioder[0].antalPersoner', true));

  await sleep(400);

  fillFormText('#ydelse.arbejdsstedsPerioder[0].gyldigFra', moment(data.projectStartDate).format('YYYY-MM-DD'));
  fillFormText('#ydelse.arbejdsstedsPerioder[0].gyldigTil', moment(data.projectEndDate).format('YYYY-MM-DD'));
  fillFormText('#ydelse.arbejdsstedsPerioder[0].antalPersoner', data.employees.length as unknown as string);

  await sleep(400);

  fillFormText('#ydelse.gyldigFra', moment(data.projectStartDate).format('YYYY-MM-DD'));
  fillFormText('#ydelse.gyldigTil', moment(data.projectEndDate).format('YYYY-MM-DD'));

  await sleep(1000);
  await setPostingState({ step: 3 });
  element('@_action_validerArbejdssted').click();
}
