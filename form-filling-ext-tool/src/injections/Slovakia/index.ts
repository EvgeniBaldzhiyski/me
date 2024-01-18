import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { SlovakiaPostingInfo } from './interfaces';
import {
  fillContactPersonForm,
  fillEmployeesForm,
  fillHostCompanyForm,
  fillPostingForm,
  statementOfHostEmployer
} from './lib';
import { element } from '../utils/dom';

void enter(Targets.Slovakia,  (targetPosting: TargetPosting<SlovakiaPostingInfo>) => {
  const {posting, employees} = targetPosting;

  if (!posting) {
    return;
  }

  const {data} = posting;
  console.log('data', data);
  element('#legal').click();
  fillHostCompanyForm(data);
  fillPostingForm(data, employees.length);
  fillContactPersonForm(data);

  for (const employeeId of employees) {
    console.log('employeeId', employeeId);
    console.log('employees', employees);
    const employee = {
      ...data.employees.find(e => e.id === employeeId),
      ...data.employeeAdditionalInfo.find(info => info.employeeId === employeeId),
    };

    fillEmployeesForm(data, employee);
  }

  statementOfHostEmployer();
  void fillingEnd(fillingIsEndMessage);
});
