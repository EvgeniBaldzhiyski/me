/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { HungaryPostingInfo } from './interfaces';
import { fillServiceProviderStep, fillServiceProvisionStep } from './lib';

void enter(Targets.Hungary, async (targetPosting: TargetPosting<HungaryPostingInfo>) => {
  const { posting } = targetPosting;

  if (!posting) {
    return;
  }

  await fillServiceProviderStep(posting.data);
  await fillServiceProvisionStep(posting.data);

  void fillingEnd(fillingIsEndMessage);
});
