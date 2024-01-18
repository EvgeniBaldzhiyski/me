import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd, setPostingState } from '../utils/simplify-api';
import { LithuaniaPostingInfo } from './interfaces';
import { formFill } from './lib';
import { element } from '../utils/dom';

void enter(Targets.Lithuania, async (targetPosting: TargetPosting<LithuaniaPostingInfo>) => {
  const {posting, employees} = targetPosting;

  if (!posting) {
    return;
  }

  const step = posting.state.step || 0;
  const employeeId = employees[step];
  const { data } = posting;

  if(employeeId){
    const employee = {
      ...data.employees.find(e => e.id === employeeId),
      ...data.employeeAdditionalInfo.find(info => info.employeeId === employeeId),
    };

    formFill(data, employee);

    if(employees[step + 1]){
      await setPostingState({step: step + 1});
      element('#ContentPlaceHolder1_LinkButton1').click();
    }else{
      void fillingEnd(fillingIsEndMessage);
    }
  }
});
