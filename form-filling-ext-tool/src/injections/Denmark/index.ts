/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { DenmarkPostingInfo } from './interfaces';
import { fillCompanyAndSectorStep, fillEmployeesStep, fillWorkplaceStep } from './lib';

void enter(Targets.Denmark, async (targetPosting: TargetPosting<DenmarkPostingInfo>) => {
  const { posting, employees } = targetPosting;
  console.log(employees);

  if (!posting) {
    return;
  }
  const { data, state } = posting;

  switch (state.step) {
    case 0: {
      await fillCompanyAndSectorStep(data);
      break;
    }
    case 1: {
      await fillEmployeesStep(data, employees);
      break;
    }
    case 2: {
      await fillWorkplaceStep(data);
      break;
    }
    case 3: {
      void fillingEnd(fillingIsEndMessage);
      break;
    }
  }
});
