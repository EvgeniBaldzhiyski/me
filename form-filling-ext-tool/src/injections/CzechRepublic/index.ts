import { TargetPosting, TargetDataState } from '../../utils/comm.map';
import { enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import { CzechPostingInfo } from './interfaces';
import { step1, step2, step3, step4, step5 } from './lib';
import { Targets } from '../../targets.enum';

void enter(Targets.CzechRepublic, async (targetPosting: TargetPosting<CzechPostingInfo, TargetDataState>) => {
  const {posting, employees} = targetPosting;
  if (!posting) {
    return;
  }

  const { data } = posting;

  await step1(data);
  await step2(data);
  await step3(data);
  await step4(data, employees);

  step5(data);

  void fillingEnd(fillingIsEndMessage);
});
