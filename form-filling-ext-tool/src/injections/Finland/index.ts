/* eslint-disable @typescript-eslint/await-thenable */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import { FinlandPostingInfo, localNeedsState } from './interfaces';
import {
  fillContractorStep,
  fillNotificationTypeStep,
  fillPlaceOfWorkStep,
  fillPostedWorkersStep,
  fillWorkingStep,
  run,
} from './lib';

void enter(
  Targets.Finland,
  async (targetPosting: TargetPosting<FinlandPostingInfo, localNeedsState>) => {
    const { posting, employees } = targetPosting;

    if (!posting) {
      return;
    }

    await run();
    await fillNotificationTypeStep(posting.data);
    await fillContractorStep(posting.data);
    await fillWorkingStep(posting.data);
    await fillPlaceOfWorkStep(posting.data);
    await fillPostedWorkersStep(posting.data, employees);

    void fillingEnd(fillingIsEndMessage);
  }
);
