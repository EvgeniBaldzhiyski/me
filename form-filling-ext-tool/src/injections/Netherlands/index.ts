/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import config from '../../utils/config';
import { element } from '../utils/dom';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { NetherlandsPostingInfo, localNeedsState } from './interfaces';
import {
  fillEmployeesStep, fillEmployerStep, fillNotificationTypeStep,
  fillProjectStep, fillReporterStep, fillServiceRecipientStep
} from './lib';


void enter(
  Targets.Netherlands,
  () => {
    try {
      element('.process-indicator');
    } catch(error) {
      return { error: config.get<string>(`targets.${window.currentTarget}.invalidEntryPoint`) };
    }

    return {};
  },
  async (targetPosting: TargetPosting<NetherlandsPostingInfo, localNeedsState>) => {
    const { posting, employees } = targetPosting;

    if (!posting) {
      return;
    }

    await fillNotificationTypeStep(posting.data);
    await fillReporterStep(posting.data);
    await fillEmployerStep(posting.data);
    await fillServiceRecipientStep(posting.data);
    await fillProjectStep(posting.data);
    await fillEmployeesStep(posting.data, employees);

    void fillingEnd(fillingIsEndMessage);
  }
);
