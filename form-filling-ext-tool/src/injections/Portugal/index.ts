/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { PortugalPostingInfo, localNeedsState } from './interfaces';
import { fillContactPersonStep, fillDurationOfPostingStep, fillEmployeesStep, fillEmployerStep, fillHostCompanyStep } from './lib';

void enter(Targets.Portugal, async (targetPosting: TargetPosting<PortugalPostingInfo, localNeedsState>) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  await fillEmployerStep(posting.data);
  await fillEmployeesStep(posting.data, employees);
  await fillHostCompanyStep(posting.data);
  await fillDurationOfPostingStep(posting.data);
  await fillContactPersonStep(posting.data);

  void fillingEnd(fillingIsEndMessage);
});
