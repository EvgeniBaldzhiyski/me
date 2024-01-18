/* eslint-disable require-await */
import moment from 'moment';
import { fetchData } from '../../utils/comm.facade';
import { EmployeeType, PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';
import { element, elements, fillFormText, onMutation, sleep } from '../utils/dom';
import { BusinessSectors, FrancePostingAdditionalInfoEmployee, FrancePostingInfo } from './interfaces';
import {
  AddressType,
  COUNTRIES,
  GENDER,
  ServiceSitesCheckBoxes,
  WorkSiteType,
  WorkSiteTypeKeys,
  documentStorageTypes,
  representativeTypes
} from './maps';

async function fillFormCombo(selector: string | HTMLInputElement, value: string) {
  const el = (typeof selector === 'string' ? element<HTMLInputElement>(selector) : selector);

  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('focusin', { bubbles: true }));

  if (!elements('.cdk-overlay-container mat-option', true)?.length) {
    await onMutation(document.body, () => elements('.cdk-overlay-container mat-option', true).length > 0);
  }

  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));

  await sleep(1000);

  const options = elements('.cdk-overlay-container mat-option');

  options[0].click();
}

async function fillFormCombo2(trigger: HTMLElement, math: string) {
  trigger.click();

  await sleep(100); // just in case

  const options = elements('.cdk-overlay-container mat-option');

  for (const option of options) {
    if (option.innerText.trim() === math) {
      option.click();
      return;
    }
  }
}

async function changeRadioBox(selector: string, value: string) {
  const radios = elements<HTMLInputElement>(`mat-radio-group[${selector}] input`);

  for (const radio of radios) {
    if (radio.value === value) {
      return radio.click();
    }
  }
}

async function goToSection(index: number, waitFor?: string) {
  const buttons = document.querySelectorAll<HTMLElement>('.dpd-sidebar button');

  await sleep(200);

  buttons[index].click();

  if (waitFor) {
    if (!element(waitFor, true)) {
      await onMutation(document.body, () => !!element(waitFor, true));
    }
  } else {
    await sleep(200);
  }
}

function genAddress({street, streetNumber, postcode, city}: PostingInfoAddress): string {
  return `${streetNumber} ${street}, ${postcode} - ${city}`;
}

function convertBusinessSectors(bs: BusinessSectors[]): Map<number, BusinessSectors[]> {
  const convert = (opt, coll?, acc?) => {
    if (!acc) {
      acc = new Map<number, BusinessSectors[]>();
    }

    if (!coll) {
      coll = [];
    }

    for (const item of opt) {
      const iColl = [...coll];

      iColl.push(item);

      acc.set(+item.id, [...iColl]);

      convert(item.children || [], iColl, acc);
    }

    return acc;
  };

  return convert(bs);
}

async function serviceSitesTemporary(data: FrancePostingInfo) {
  fillFormText('input[formcontrolname=nom]', data.workSiteName);

  if (data.workSiteAddress.street) {
    const address = genAddress(data.workSiteAddress);

    await fillFormCombo('input[applabel="common.adresse"]', address);
  } else {
    await changeRadioBox('formcontrolname=typeAdresse', AddressType.COORDONNEES);
    await onMutation(document.body, () => !!element('input[applabel="common.ville"]', true));

    await fillFormCombo('input[applabel="common.ville"]', `${data.workSiteAddress.postcode} ${data.workSiteAddress.city}`);

    await onMutation(document.body, () => !!element('.search-overlay button', true));

    element('.search-overlay button').click();

    await onMutation(document.body, () => !!element('input[applabel="common.latitude"]', true));

    fillFormText('input[applabel="common.latitude"]', `${data.workSiteAddress.latitude}`);
    fillFormText('input[applabel="common.longitude"]', `${data.workSiteAddress.longitude}`);

    await sleep(200);

    elements('.mat-focus-indicator.mat-primary.mat-raised-button.mat-button-base')[1].click();
  }
}

function serviceSitesCustomer() {
  element('button[data-cy=button-select-0]').click();
}

async function serviceSitesNotTemporary(data: FrancePostingInfo) {
  fillFormText('input[formcontrolname=siren]', data.workSiteAddress.siretNumber);
  await sleep(200); // just in case

  element('button.search-field').click();

  await onMutation(document.body, () => !!element('button[data-cy=button-select-0]'));

  await sleep(400);
  element('button[data-cy=button-select-0]').click();
}

// ---

export async function foreignCompany(data: FrancePostingInfo): Promise<void> {
  await sleep(500);

  await goToSection(0, '@organisme');

  fillFormText('@organisme', data.financialGuaranteeBody);
}

export async function recipientCompany(data: FrancePostingInfo): Promise<void> {
  await goToSection(1, '@country');

  await fillFormCombo('@country', COUNTRIES[data.hostCompanyAddress.country]);

  await sleep(200); // give it some time because Angular throws and error

  if (+data.hostCompanyAddress.country === 61) { // France
    if (data.hostCompanyVatNumber) {
      fillFormText('@numTVA', data.hostCompanyVatNumber);
    } else if (data.hostCompanySirenNumber) {
      await changeRadioBox('name=selectedIdentifierFr', '1');
      await onMutation(document.body, () => !!element('@siren', true));
      fillFormText('@siren', data.hostCompanySirenNumber);
    } else {
      await changeRadioBox('name=selectedIdentifierFr', '2');

      fillFormText('@raisonSociale', data.hostCompanyName);
      await fillFormCombo('app-address-form-2 input', genAddress(data.hostCompanyAddress));
    }
  } else {
    if (data.hostCompanyVatNumber) {
      fillFormText('@numTVA', data.hostCompanyVatNumber);
    } else {
      element('@noTVA').click();
    }

    fillFormText('@raisonSociale', data.hostCompanyName);
    fillFormText('input[formcontrolname=adresse]',
      `${data.hostCompanyAddress.streetNumber} ${data.hostCompanyAddress.street}`
    );
    fillFormText('@cp-no-autocomplete', data.hostCompanyAddress.postcode);
    fillFormText('@city-no-autocomplete', data.hostCompanyAddress.city);
  }

  fillFormText('@email', data.hostCompanyAddress.email);
}

export async function serviceSites(data: FrancePostingInfo) {
  await goToSection(2, '@location-type');

  await changeRadioBox('name=location-type', WorkSiteType[data.workSiteType]);

  await sleep(500);

  switch(data.workSiteType) {
    case WorkSiteTypeKeys.CUSTOMER_WORK_SITE:
      if (!element('input[formcontrolname=siren]', true)) {
        serviceSitesCustomer();
        return;
      } else {
        await serviceSitesNotTemporary(data);
      }
      break;
    case WorkSiteTypeKeys.DIFFERENT_WORK_SITE:
      await serviceSitesNotTemporary(data);
      break;
    case WorkSiteTypeKeys.TEMPORARY_WORK_SITE:
      await serviceSitesTemporary(data);
      break;
  }

  const checkboxes = elements('mat-checkbox input');

  for (const [index, key] of ServiceSitesCheckBoxes.entries()) {
    if (data[key]) {
      checkboxes[index].click();
    }
  }

  if (data.colleciveAccommodationName) {
    element('mat-slide-toggle input').click();

    await onMutation(document.body, () => !!element('input[name=nomHebergement]', true));

    fillFormText('input[name=nomHebergement]', data.colleciveAccommodationName);

    if (data.colleciveAccommodationAddress.street) {
      const address = genAddress(data.colleciveAccommodationAddress);
      const addressFields = elements<HTMLInputElement>('input[applabel="common.adresse"]');

      await fillFormCombo(addressFields[1], address);
    } else {
      await sleep(200);
      await changeRadioBox('formcontrolname=typeAdresseHebergement', AddressType.COORDONNEES);

      await sleep(100);

      const valeeAddressFields = elements<HTMLInputElement>('input[applabel="common.ville"]');
      await fillFormCombo(valeeAddressFields[1] || valeeAddressFields[0], (
        `${data.colleciveAccommodationAddress.postcode} ${data.colleciveAccommodationAddress.city}`
      ));

      await sleep(100);

      const searchOverlayButton = elements('.search-overlay button');
      (searchOverlayButton[1] || searchOverlayButton[0]).click();

      await sleep(400);

      const latitudes = elements<HTMLInputElement>('input[applabel="common.latitude"]');
      fillFormText(latitudes[2] || latitudes[0], `${data.colleciveAccommodationAddress.latitude}`);

      const longitudes = elements<HTMLInputElement>('input[applabel="common.longitude"]');
      fillFormText(longitudes[2] || longitudes[0], `${data.colleciveAccommodationAddress.longitude}`);

      await sleep(200);

      const selectBtns = elements('.mat-focus-indicator.mat-primary.mat-raised-button.mat-button-base');
      (selectBtns[3] || selectBtns[1]).click();
    }
  }

  await sleep(400);
  element('button[aria-label=Save]').click();
}

export async function infoService(data: FrancePostingInfo) {
  await goToSection(3, 'app-activite-form-2');

  const businessSectors = await fetchData<BusinessSectors[]>(
    `business-sectors/posting-country/${data.postingStateCountry.id}`, null, {method: 'get'}
  );

  const businessSectorsMap = convertBusinessSectors(businessSectors);
  const businessSectorLeaf = businessSectorsMap.get(data.hostCompanyBusinessSectorId);

  const index = (elements('app-button-info').length === 3 ? 1 : 0);

  await fillFormCombo2(elements('mat-select .mat-select-arrow-wrapper')[0 + index], businessSectorLeaf[0].tooltip);
  await sleep(100);
  await fillFormCombo2(elements('mat-select .mat-select-arrow-wrapper')[1 + index], businessSectorLeaf[1].tooltip);
  await sleep(100);
  await fillFormCombo2(elements('mat-select .mat-select-arrow-wrapper')[2 + index], businessSectorLeaf[2].tooltip);
  await sleep(100);
  await fillFormCombo2(elements('mat-select .mat-select-arrow-wrapper')[3 + index], businessSectorLeaf[3].tooltip);
}

export async function postingEmployees(data: FrancePostingInfo, employees: string[]) {
  await goToSection(4, 'mat-radio-group[formcontrolname="sexe"] input');

  const employeesSet = new Set(employees);
  const additionalEmployeesMap = new Map<string, FrancePostingAdditionalInfoEmployee>();
  for (const ae of data.employeeAdditionalInfo) {
    additionalEmployeesMap.set(ae.employeeId, ae);
  }

  for (const [index, _employee] of data.employees.entries()) {
    if (!employeesSet.has(_employee.id)) {
      continue;
    }

    if (index > 0) {
      element('button.add-worker').click();
      await sleep(400); // just in case
    }

    const employee: PostingInfoEmployee & FrancePostingAdditionalInfoEmployee = {
      ..._employee, ...additionalEmployeesMap.get(_employee.id)
    };

    await changeRadioBox('formcontrolname="sexe"', GENDER[employee.gender]);

    fillFormText('@nom', employee.lastName);
    fillFormText('@firstname', employee.firstName);
    fillFormText('app-date-form-2[formcontrolname=dateNaissance] input', moment(employee.dateOfBirth).format('DD/MM/YYYY'));
    fillFormText('@city-of-birth', employee.townOfBirth);

    await fillFormCombo('app-country-autocomplete-2[name="country-of-birth"] input', COUNTRIES[employee.countryOfBirth]);
    await fillFormCombo('app-country-autocomplete-2[data-cy="nationalite"] input', COUNTRIES[employee.nationality]);

    await fillFormCombo('app-address-form-2 app-country-autocomplete-2 input[name="country"]', COUNTRIES[employee.address.country]);

    fillFormText('input[formcontrolname="adresse"]', `${employee.address.streetNumber} ${employee.address.street}`);
    fillFormText('input[formcontrolname="cp"]', employee.address.postcode);
    fillFormText('input[formcontrolname="ville"]', employee.address.city);

    await fillFormCombo('app-country-autocomplete-2[data-cy="pays-secu"] input', COUNTRIES[employee.countryOfLegislation]);

    fillFormText(
      elements<HTMLInputElement>('app-date-form-2[formcontrolname=dateDebut] input')[1],
      moment(data.startDate).format('DD/MM/YYYY')
    );

    fillFormText(
      elements<HTMLInputElement>('app-date-form-2[formcontrolname=dateFin] input')[1],
      moment(data.endDate).format('DD/MM/YYYY')
    );

    if (employee.reasonForLongTermPosting) {
      element('input[name="detachement-longue-duree"]').click();

      await sleep(200);
      fillFormText('input[name="motif-longue-duree"]', employee.reasonForLongTermPosting);
    }

    fillFormText('input[formcontrolname="emploi"]', employee.positionHeldInFrance);

    await fillFormCombo2(
      element('app-qualification-form-2 .mat-select-arrow-wrapper'),
      employee.professionalQualification
    );

    if (employee.grossHourlyRateOfPay) {
      fillFormText('input[formcontrolname="salaire"]', `${employee.grossHourlyRateOfPay}`);
    } else {
      element('input[name="specificSalary"]').click();
    }

    element('button[aria-label=Save]').click();
  }
}

export async function representativePerson(data: FrancePostingInfo) {
  await goToSection(5, 'input[formcontrolname="telephone"]');

  const {employeeType, position, firstName, address, telephoneNumber, email} = data.representativePerson;

  await changeRadioBox('name="typeRepresentant"', representativeTypes[employeeType]);

  await sleep(200);

  if (employeeType === EmployeeType.EMPLOYEE_REPRESENTATIVE) {
    element('.workers-dropdown div').click();

    await sleep(200);

    const workers = elements('.workers-dropdown button.mat-tooltip-trigger');
    const targetEmployee = data.employees.find(e => `${e.id}` === position);

    for (const worker of workers) {
      if (worker.innerText === `${targetEmployee?.lastName} ${targetEmployee?.firstName}`) {
        worker.click();
        break;
      }
    }
  }

  if (employeeType === EmployeeType.PROFESSIONAL_REPRESENTATIVE) {
    fillFormText('input[formcontrolname="siret"]', address.siretNumber);
    fillFormText('input[formcontrolname="raisonSociale"]', firstName);

    await fillFormCombo('input[applabel="common.adresse"]', genAddress(address));
  }

  fillFormText('input[name="telephone"]', telephoneNumber);
  fillFormText('input[name="email"]', email);

  await changeRadioBox('name="conservation"', documentStorageTypes[data.locationOfTheStoredDocuments]);
}
