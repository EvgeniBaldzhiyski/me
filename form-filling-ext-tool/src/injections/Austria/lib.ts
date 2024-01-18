import { AustriaPostingInfo, PostingInfoEmployeeAustria } from './interfaces';
import { fillingEnd, setPostingState } from '../utils/simplify-api';
import { element } from './helpers';
import { COUNTRIES, PAY_AMOUNT_TYPE } from './maps';
import moment from 'moment';
import { EmployeeType } from '../../utils/interfaces';
import { selectValueByText } from '../utils/dom';
import { fillingIsEndMessage } from '../utils/labels';

function fillPostingCompany(data: AustriaPostingInfo) {
  const prefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block1_Block1_b1_';

  element(`#${prefix}Name_input`).value = data.postingCompanyName;
  element(`#${prefix}EMailAdresse_input`).value = data.postingCompanyAddress.email;
  element(`#${prefix}GewerbebefugnisUGegenstand_input`).value = (
    `${data.postingCompanyBusinessSector.code} ${data.postingCompanyBusinessSector.description}`
  );
  element(`#${prefix}UID_input`).value = data.postingCompanyVatNumber;
  element(`#${prefix}PLZ_input`).value = data.postingCompanyAddress.postcode;
  element(`#${prefix}Ort_input`).value = data.postingCompanyAddress.city;
  element(`#${prefix}TelNr_input`).value = data.postingCompanyAddress.telephone;
  element(`#${prefix}Adresse_input`).value = (
    `${data.postingCompanyAddress.street} ${data.postingCompanyAddress.streetNumber}`
  );

  selectValueByText(`#${prefix}Land_input`, COUNTRIES[+data.postingCompanyAddress.country]);
}

function fillEntrustedPerson(data: AustriaPostingInfo) {
  const prefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block2_Block2_b2_';
  const {firstName, lastName, dateOfBirth, nationality, address, telephoneNumber, email} = data.representativePerson;

  element(`#${prefix}Name_input`).value = lastName;
  element(`#${prefix}Vornamen_input`).value = firstName;
  element(`#${prefix}Geburtsdatum_input`).value = moment(dateOfBirth).format('DD.MM.YYYY'); // date
  element(`#${prefix}PLZ_input`).value = address.postcode;
  element(`#${prefix}Ort_input`).value = address.city;
  element(`#${prefix}TelNr_input`).value = telephoneNumber;
  element(`#${prefix}EMailAdresse_input`).value = email;
  element(`#${prefix}Adresse_input`).value = address.street;

  selectValueByText(`#${prefix}Staatsbuergerschaft_input`, COUNTRIES[+nationality]); // select
  selectValueByText(`#${prefix}Land_input`, COUNTRIES[+address.country]); // SELECT
}

function fillContactPerson(data: AustriaPostingInfo) {
  const {firstName, lastName, dateOfBirth, address, nationality, employeeType, telephoneNumber, email} = data.contactPerson;

  const type = (employeeType === EmployeeType.CONTACT_PERSON_SECONDED ? 1 : 2);

  let prefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block3_Block3_';

  element(`#${prefix}GruppeFlieszend1_ddlAnsprechperson_input_${type}`).click();

  prefix+= 'b2_';

  element(`#${prefix}Name_input`).value = lastName;
  element(`#${prefix}Vornamen_input`).value = firstName;
  element(`#${prefix}Geburtsdatum_input`).value = moment(dateOfBirth).format('DD.MM.YYYY'); // date
  element(`#${prefix}Adresse_input`).value = `${address.street} ${address.streetNumber}`;
  element(`#${prefix}PLZ_input`).value = address.postcode;
  element(`#${prefix}Ort_input`).value = address.city;
  element(`#${prefix}TelNr_input`).value = telephoneNumber;
  element(`#${prefix}EMailAdresse_input`).value = email;

  selectValueByText(`#${prefix}Staatsbuergerschaft_input`, COUNTRIES[+nationality]); // select
  selectValueByText(`#${prefix}Land_input`, COUNTRIES[+address.country]); // SELECT
}

function fillHostCompany(data: AustriaPostingInfo) {
  const type = data.hostCompanyType === 'HOST_COMPANY' ? 1 : 2;

  let prefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block4_';

  element(`#${prefix}GruppeFlieszend3_ddlAuftragperson_input_${type}`).click();

  prefix += 'b4_';

  element(`#${prefix}Name_input`).value = data.hostCompanyName;
  element(`#${prefix}UID_input`).value = data.hostCompanyVatNumber || '';
  element(`#${prefix}Adresse_input`).value = `${data.hostCompanyAddress.street} ${data.hostCompanyAddress.streetNumber}`;
  element(`#${prefix}PLZ_input`).value = data.hostCompanyAddress.postcode;
  element(`#${prefix}Ort_input`).value = data.hostCompanyAddress.city;
  element(`#${prefix}TelNr_input`).value = data.hostCompanyAddress.telephone;
  element(`#${prefix}EMailAdresse_input`).value = data.hostCompanyAddress.email;
  element(`#${prefix}ArtBetrieb_input`).value = data.hostStateCountryBusinessSector.description;

  selectValueByText(`#${prefix}Land_input`, COUNTRIES[+data.hostCompanyAddress.country]); // select
}

function fillTimePeriod(data: AustriaPostingInfo) {
  const prefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block5_BlockZR_b6_';

  element(`#${prefix}BeginnDat_input`).value = moment(data.startDate).format('DD.MM.YYYY'); // date
  element(`#${prefix}EndeDat_input`).value = moment(data.endDate).format('DD.MM.YYYY'); // date
}

function fillRepresentative(data: AustriaPostingInfo) {
  const representativePrefix = 'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block7';

  const {documentStorageType, firstName, lastName, address, telephoneNumber, email} = data.documentPerson;

  const fill = (code = '') => {
    element(`#${representativePrefix}_b7${code}_Name_input`).value = lastName;
    element(`#${representativePrefix}_b7${code}_VName_input`).value = firstName;
    element(`#${representativePrefix}_b7${code}_Adresse_input`).value = address.street;
    element(`#${representativePrefix}_b7${code}_PLZ_input`).value = address.postcode;
    element(`#${representativePrefix}_b7${code}_Ort_input`).value = address.city;
    element(`#${representativePrefix}_b7${code}_TelNr_input`).value = telephoneNumber;
    element(`#${representativePrefix}_b7${code}_EMailAdresse_input`).value = email;
  };

  const REPRESENTATIVE_FILL_MAP = {
    HOST_COMPANY: () => {
      element(`#${representativePrefix}_GruppeFlieszend5_b7_CheckA_input_0`).click();
    },
    CONTACT_PERSON: () => {
      element(`#${representativePrefix}_GruppeFlieszend11_b7_CheckB_input_0`).click();
    },
    REPRESENTATIVE_ADDRESS: () => {
      element(`#${representativePrefix}_GruppeFlieszend8_b7_CheckC_input_0`).click();

      fill();
    },
    ONSITE: () => {
      element(`#${representativePrefix}_GruppeFlieszend7_b7_CheckD_input_0`).click();

      fill('2');
    },
    STORAGE_PLACE: () => {
      element(`#${representativePrefix}_GruppeFlieszend12_b7_CheckE_input_0`).click();

      fill('2');
    },
  };

  REPRESENTATIVE_FILL_MAP[documentStorageType]();
}

function fillLocationIn(data: AustriaPostingInfo, index: number) {
  const prefix = (
    `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block6_GruppeFlieszend10_GrpOrtValidation_GrpRptOrte_list__${index + 1}_ort_`
  );

  const {address: {postcode, city, district, street}} = data.workSites[index];

  element(`#${prefix}PLZ_input`).value = postcode;
  element(`#${prefix}Ort_input`).value = city;
  element(`#${prefix}Anschrift_input`).value = street;

  selectValueByText(`#${prefix}Bundesland_input`, district);
}

function prepareSelectedEmployee(employees: PostingInfoEmployeeAustria[], getSelectedEmployeeIds: string[]): PostingInfoEmployeeAustria[] {
  const filteredEmployees: PostingInfoEmployeeAustria[] = [];
  const setOfSelectedEmployees = new Set(getSelectedEmployeeIds);

  for(const employee of employees) {
    if (setOfSelectedEmployees.has(employee.id)) {
      filteredEmployees.push(employee);
    }
  }

  return filteredEmployees;
}

function fillEmployee(employee: PostingInfoEmployeeAustria, data: AustriaPostingInfo, index: number) {
  let prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_b4_`;

  const specificData = employee.notificationPluginEmployeeAustriaDto;

  element(`#${prefix}Name_input`).value = employee.lastName;
  element(`#${prefix}Vorname_input`).value = employee.firstName;
  selectValueByText(`#${prefix}Staatsbuergerschaft_input`, COUNTRIES[+employee.nationality]); // select
  element(`#${prefix}Geburtsdatum_input`).value = moment(employee.dateOfBirth).format('DD.MM.YYYY'); // date
  element(`#${prefix}SVNR_input`).value = specificData.socialSecurityNumber;
  element(`#${prefix}SVTraeger_input`).value = specificData.socialInsuranceAgency;
  element(`#${prefix}Adresse_input`).value = `${employee.address.street} ${employee.address.streetNumber}`;
  element(`#${prefix}PLZ_input`).value = employee.address.postcode;
  element(`#${prefix}Ort_input`).value = employee.address.city;
  selectValueByText(`#${prefix}Land_input`, COUNTRIES[+employee.address.country]); // select
  element(`#${prefix}ArtTaetigkeit_input`).value = specificData.typeOfWorkAndDeployment; // textarea
  element(`#${prefix}Bautaetigkeit_input`).value = ((+!specificData.constructionWork) + 1).toString(); // select(Yes/No)

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_grpDauer_dauer_`;

  element(`#${prefix}BeginnDatum_input`).value = moment(data.startDate).format('DD.MM.YYYY'); // date
  element(`#${prefix}EndeDatum_input`).value = moment(data.endDate).format('DD.MM.YYYY'); // date

  prefix = (
    // eslint-disable-next-line max-len
    `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_grpDauer_grpArbeitszeit_list__1_dauer_`
  );

  element(`#${prefix}vonZeit_input`).value = specificData.workingStartTime;
  element(`#${prefix}bisZeit_input`).value = specificData.workingEndTime;
  element(`#${prefix}arbeitZeit_input`).value = specificData.workingHours;

  // SECTION 2

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_b4p2_`;

  element(`#${prefix}Hoehe_input`).value = specificData.payAmount;
  element(`#${prefix}Zeitraum_input`).value = PAY_AMOUNT_TYPE[specificData.payAmountType]; // select
  element(`#${prefix}Sonstiges_input`).value = specificData.miscellaneous;

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_b8_`;

  element(`#${prefix}BeginnArbeitsverhaeltnisDatum_input`).value = moment(specificData.startOfEmployment).format('DD.MM.YYYY'); // date

  // SECTION 3

  element(`#${prefix}Anmerkungen_input`).value = specificData.notes; // textarea

  // SECTION 4

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_grpBe_grp_`;

  element(`#${prefix}Behoerde_input`).value = specificData.eaIssuingAuthority;
  element(`#${prefix}Geschaeftszahl_input`).value = specificData.eaFileNumber;
  if (specificData.eaIssuingAuthority) { 
    element(`#${prefix}Ausstellungsdatum_input`).value = moment(specificData.eaDateOfIssue).format('DD.MM.YYYY'); // date
  }
  element(`#${prefix}Geltungsdauer_input`).value = specificData.eaValidityPeriod;

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_`;

  element(`#${prefix}be_Beilagen_input`).value = (+!specificData.eaResidencePermit).toString(); // select(Yes/No)
  element(`#${prefix}auf_Beilagen_input`).value = (+!specificData.rpEmploymentAuthorization).toString(); // select(Yes/No)

  prefix = `Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_list__${index}_BlockRptGrp_grpAuf_grp_`;

  element(`#${prefix}Behoerde_input`).value = specificData.rpIssuingAuthority;
  element(`#${prefix}Geschaeftszahl_input`).value = specificData.rpFileNumber;
  if (specificData.rpIssuingAuthority) {
    element(`#${prefix}Ausstellungsdatum_input`).value = moment(specificData.rpDateOfIssue).format('DD.MM.YYYY'); // date
  }
  element(`#${prefix}Geltungsdauer_input`).value = specificData.rpValidityPeriod;
}

export async function runStep0(data: AustriaPostingInfo): Promise<void> {
  const addWorkSiteButtonId = (
    'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block6_GruppeFlieszend10_GrpOrtValidation_GrpRptOrte_buttons__1_input'
  );
  const nextButtonId = 'Xml_zko_3_Steps_Seitenfolge1_ctl00_next_input';

  fillPostingCompany(data);
  fillEntrustedPerson(data);
  fillContactPerson(data);
  fillHostCompany(data);
  fillTimePeriod(data);
  fillRepresentative(data);
  fillLocationIn(data, 0);

  if (data.workSites.length > 1) {
    await setPostingState({step: 1, location: 1});

    element(`#${addWorkSiteButtonId}`).click();
  } else {
    await setPostingState({step: 2});

    element(`#${nextButtonId}`).click();
  }
}

export async function runStep1(data: AustriaPostingInfo, location: number): Promise<void> {
  const addWorkSiteButtonId = (
    'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite1_Block6_GruppeFlieszend10_GrpOrtValidation_GrpRptOrte_buttons__1_input'
  );
  const nextButtonId = 'Xml_zko_3_Steps_Seitenfolge1_ctl00_next_input';

  fillLocationIn(data, location);

  if (data.workSites.length - 1 > location) {
    await setPostingState({step: 1, location: (location + 1)});

    element(`#${addWorkSiteButtonId}`).click();
  } else {
    await setPostingState({step: 2});

    element(`#${nextButtonId}`).click();
  }
}

export async function runStep2(data: AustriaPostingInfo, employeeIndex: number, selectedEmployees: string[]): Promise<void> {
  const addWorkSiteButtonId = (
    'Xml_zko_3_Steps_Seitenfolge1_Inner_Seite2_BlockMain_BlockMain_BlockRpt_buttons__1_input'
  );
  const nextButtonId = 'Xml_zko_3_Steps_Seitenfolge1_ctl00_next_input';

  const employees = prepareSelectedEmployee(data.employees, selectedEmployees);
  const employee = employees[employeeIndex];

  fillEmployee(employee, data, employeeIndex + 1);

  if (employees.length - 1 > employeeIndex) {
    await setPostingState({step: 2, employeeIndex: (employeeIndex + 1)});

    element(`#${addWorkSiteButtonId}`).click();
  } else {
    await setPostingState({step: 3});

    element(`#${nextButtonId}`).click();
  }
}

export function runStep3() {
  void fillingEnd(fillingIsEndMessage);
}
