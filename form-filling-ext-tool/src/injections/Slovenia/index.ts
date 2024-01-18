/* eslint-disable @typescript-eslint/await-thenable */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import {
  fillContactPersonStep,
  fillDurationStep,
  fillEmployerStep,
  fillLocationStep,
  fillOrderingStep,
  fillPostedWorkersStep,
  fillResponsibleOfficerStep,
  fillServiceStep
} from './lib';
import { SlovenianPostingInfo, localNeedsState } from './interfaces';

void enter(
  Targets.Slovenia,
  async (targetPosting: TargetPosting<SlovenianPostingInfo, localNeedsState>) => {
    const { posting, employees } = targetPosting;

    if (!posting) {
      return;
    }

    await fillEmployerStep(posting.data);
    await fillResponsibleOfficerStep(posting.data);
    await fillServiceStep(posting.data);
    await fillLocationStep(posting.data);
    await fillDurationStep(posting.data);
    await fillOrderingStep(posting.data);
    await fillPostedWorkersStep(posting.data, employees);
    await fillContactPersonStep(posting.data);

    void fillingEnd(fillingIsEndMessage);
  }
);
