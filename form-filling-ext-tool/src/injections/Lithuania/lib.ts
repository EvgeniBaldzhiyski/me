import moment from 'moment';
import {element as defaultElement, fillFormText, selectValueByText} from '../utils/dom';
import { LithuaniaPostingAdditionalInfoEmployee, LithuaniaPostingInfo } from './interfaces';
import { COUNTRIES, IDENTIFY_NUMBER_TYPE } from './maps';
import { PostingInfoAddress, PostingInfoEmployee } from '../../utils/interfaces';

function element<R extends HTMLInputElement | HTMLSelectElement>(
  selector: string,
  allowUndefined = false
): R {
  return defaultElement<R>(selector, allowUndefined);
}

function getAddress({street , streetNumber, postcode, city, country}: PostingInfoAddress): string {
  return `${street} ${streetNumber}, ${postcode} ${city}, ${country}`;
}

export function formFill(data: LithuaniaPostingInfo, employee: PostingInfoEmployee & LithuaniaPostingAdditionalInfoEmployee) {
  element('#ContentPlaceHolder1_TextBoxVardas').value = employee.firstName;
  element('#ContentPlaceHolder1_TextBoxPavarde').value = employee.lastName;
  fillFormText('#ctl00_ContentPlaceHolder1_RadDatePicker1_dateInput', moment(employee.dateOfBirth).format('YYYY-MM-DD'));
  selectValueByText('#ContentPlaceHolder1_DDL_citizen', COUNTRIES[employee.nationality], 'include');
  element('#ContentPlaceHolder1_DDL_ID').value = IDENTIFY_NUMBER_TYPE[employee.identifyNumberType as string];
  fillFormText('#ctl00_ContentPlaceHolder1_RadDatePicker2_dateInput', moment(employee.identifyNumberTypeExpDate).format('YYYY-MM-DD'));
  element('#ContentPlaceHolder1_TextBoxSerija').value = employee.identifyNumber;
  selectValueByText('#ContentPlaceHolder1_DDL_work', data.hostStateCountryBusinessSector.description);
  element('#ContentPlaceHolder1_TextBoxPakeitimas').value = employee.replacedWorkerFullName;
  selectValueByText('#ContentPlaceHolder1_DDL_insurance_country', COUNTRIES[employee.countryOfSocialInsurance], 'include');
  element('#ContentPlaceHolder1_DDL_Pazyma').value = employee.socialSecurityCertificate ? 'Yes' : 'No';
  element('#ContentPlaceHolder1_DDL_pagrindas').value = data.basisOfSecondment;
  fillFormText('#ctl00_ContentPlaceHolder1_RadDatePicker3_dateInput', moment(data.startDate).format('YYYY-MM-DD'));
  fillFormText('#ctl00_ContentPlaceHolder1_RadDatePicker4_dateInput', moment(data.endDate).format('YYYY-MM-DD'));
  element('#ContentPlaceHolder1_TextBoxDarboVieta').value = getAddress(data.workplaceAddress);
  element('#ContentPlaceHolder1_TextBoxDokVieta').value = getAddress(data.documentStorageAddress);
  element('#ContentPlaceHolder1_ButtonTD', true)?.click();
}
