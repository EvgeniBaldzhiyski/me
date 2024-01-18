/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { SwitzerlandPostingInfo, localNeedsState } from './interfaces';
import { fillConfirmComplianceStep, fillContactDetailsStep, fillEmployeesStep, fillPlaceOfWorkStep, fillStayStep } from './lib';

void enter(Targets.Switzerland, async (targetPosting: TargetPosting<SwitzerlandPostingInfo, localNeedsState>) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  await fillContactDetailsStep(posting.data);
  await fillStayStep(posting.data);
  await fillPlaceOfWorkStep(posting.data);
  await fillEmployeesStep(posting.data, employees);
  await fillConfirmComplianceStep();

  void fillingEnd(fillingIsEndMessage);
});
