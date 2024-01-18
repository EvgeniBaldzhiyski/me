import moment from 'moment';
import { element as defaultElement, elements, fillFormFile, onMutation, sleep } from '../utils/dom';
import { NatureOfPosting } from './maps';
import { MaltaPostingAdditionalInfoEmployee, MaltaPostingInfo } from './interfaces';
import { PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement>(selector: string, allowUndefined = false): R {
  return defaultElement<R>(selector, allowUndefined);
}

function fillDateField(name: string, value: number) {
  const el = element(`div[name="${name}"] input`);

  el.dispatchEvent(new Event('focus'));
  el.value = moment(value).format('DD/MM/YYYY');
  el.dispatchEvent(new Event('change'));
  el.dispatchEvent(new Event('blur'));
}

function fillTextField(selector: string, value: string) {
  const el = element(selector);

  el.dispatchEvent(new Event('focus'));
  el.value = value;
  el.dispatchEvent(new Event('change'));
  el.dispatchEvent(new Event('blur'));
}

async function fillFileField(form: HTMLFormElement, source: string): Promise<void> {
  const input = form.querySelector<HTMLInputElement>('input');

  await fillFormFile(input, source);

  input.dispatchEvent(new Event('change'));
}

async function fillAutoCompleteField(name: string, value: string): Promise<void> {
  const container = element(`div[name="${name}"]`);
  const input = container.querySelector('input');

  input.value = value;
  input.dispatchEvent(new Event('input'));

  if (!element(`.autocomplete-menu-${container.id}`, true)) {
    await onMutation(document.body, () => !!element(`.autocomplete-menu-${container.id}`, true));
  }

  element(`.autocomplete-menu-${container.id} li`).click();

  await sleep(1);

  return Promise.resolve();
}

function fillSelectField(id: string, value: string): void {
  const container = element(`#${id}_droplist`);
  const options = container.querySelectorAll<HTMLLIElement>('ul.drop-menu li');

  for (const option of Array.from(options)) {
    if (option.title.includes(value)) {
      option.click();
      break;
    }
  }
}

function genAddressString(address: PostingInfoAddress): string {
  const { postcode, city, street, streetNumber } = address;

  return `${postcode} ${city}, ${street} ${streetNumber}`;
}

export async function setupLanguage() {
  element('@EnglishFlagBtn').click();

  await sleep(500);
}

export function natureOfPosting(posting: MaltaPostingInfo): void {
  const radioButtons = elements<HTMLInputElement>('div[name="Posting Nature Drop-Down List en"] .choice-control-item-row input');
  for (const radioButton of radioButtons){
    if (radioButton.value === NatureOfPosting[posting.natureOfPosting]) {
      radioButton.click();
    }
  }
}

export async function detailsAboutSendingParty(posting: MaltaPostingInfo): Promise<void> {
  fillTextField('@AgencyNameTextBox', posting.postingCompanyName);
  fillTextField('@BusinessSectorTextBox', posting.postingCompanyBusinessSector.description);
  fillTextField('@AgencyAddressTextBox', genAddressString(posting.postingCompanyAddress));
  fillTextField('@AgencyEmailTextBox', posting.postingCompanyAddress.email);
  fillTextField('@AgencyTelephoneTextBox', posting.postingCompanyAddress.telephone);

  if (posting.subcontractorName) {
    element('@SubcontractorsInvolvedCheckBox').click();

    if (!element('@SubContractorNameTextBox', true)) {
      await onMutation(document.body, () => !!element('@SubContractorNameTextBox', true));
    }

    fillTextField('@SubContractorNameTextBox', posting.subcontractorName);
  }
}

export function detailsOfSpecialPersons({ contactPerson, representativePerson }: MaltaPostingInfo): void {
  fillTextField('@ContactNameTextBox', contactPerson.fullName);
  fillTextField('@ContactEmailTextBox', contactPerson.email);
  fillTextField('@BargainingRepNameTextBox', representativePerson.fullName);
  fillTextField('@BargainingRepEmailTextBox', representativePerson.email);
}

export function detailsOfUndertakingInMalta(posting: MaltaPostingInfo): void {
  fillTextField('@UndertakingNameTextBox', posting.hostCompanyName);
  fillTextField('@UndertakingAddressTextBox', genAddressString(posting.hostCompanyAddress));
  fillTextField('@UndertakingWorkTextBox', posting.typeOfWork);

  fillDateField('UndertakingStartDateTextBox', posting.startDate);
  fillDateField('UndertakingEndDateTextBox', posting.endDate);
}

export async function detailsOfPostedWorker(employee: PostingInfoEmployee & MaltaPostingAdditionalInfoEmployee): Promise<void> {
  fillTextField('@NameTextBox', employee.fullName);

  fillDateField('BirthDateTextBox', employee.dateOfBirth);

  await fillAutoCompleteField('NationalityAuto-Complete', employee.nationality);

  fillTextField('@IdentificationTypeTextBox', employee.identifyNumberType);
  fillTextField('@IdentificationNumberTextBox', employee.identifyNumber);

  await fillAutoCompleteField('IssuingCountryAuto-Complete', employee.identifyCountryOfIssue);

  fillDateField('ExpiryDateTextBox', employee.identifyExpiryDate);

  fillTextField('@EmailTextBox', employee.email);
  fillTextField('@AddressTextBox', genAddressString(employee.address));

  fillDateField('StartDateTextBox', employee.employmentDate);

  fillSelectField('85ad81a0-c574-27d4-389c-6ba3c3c7457c_f65a5f81-f97c-98f6-078e-f1835d9dfaaa', employee.typeOfContract);

  fillTextField('@Type of Contract To Specify Text Box', employee.typeOfContractSpecificity);

  fillTextField('@JobTextBox', employee.job);
  fillTextField('@RateHourTextBox', `${employee.hourlyRateOfPay || ''}`);
  fillTextField('@WorkingHoursTextBox', `${employee.hoursOfWorkDuringPosting || ''}`);
  fillTextField('@OvertimeRateTextBox', `${employee.overtimeRateOfPay || ''}`);

  fillTextField('@WagePaymentsPeriodTextBox', employee.wagePaymentPeriod);

  if (employee.postingAllowancesAmount) {
    element('@SpecificAllowanceCheckBox').click();

    if (!element('@AllowanceAmountTextBox', true)) {
      await onMutation(document.body, () => !!element('@AllowanceAmountTextBox', true));
    }

    fillTextField('@AllowanceAmountTextBox', `${employee.postingAllowancesAmount || ''}`);
  }

  if (employee.expensesCoveredByPostingCompany) {
    element('@AccommodationExpensesCheckBox').click();
  }
}

export async function attachments(employee: MaltaPostingAdditionalInfoEmployee): Promise<void> {
  const fileInputs = elements<HTMLFormElement>('form.file-input');

  console.log('EMPLOYEE ->', employee);

  if (employee.contractOfEmploymentId) {
    await fillFileField(fileInputs[0], employee.contractOfEmploymentId);
  }

  if (employee.identificationDocumentId) {
    await fillFileField(fileInputs[1], employee.identificationDocumentId);
  }

  if (employee.postingSpecificDocumentsId) {
    await fillFileField(fileInputs[2], employee.postingSpecificDocumentsId);
  }
}
