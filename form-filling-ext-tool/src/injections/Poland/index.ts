/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable no-use-before-define */
import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { fillingIsEndMessage } from '../utils/labels';
import { enter, fillingEnd } from '../utils/simplify-api';
import { PolishPostingInfo } from './interfaces';
import {
  fillAttorneyInFactStep,
  fillContactDetailsStep,
  fillContactPersonStep,
  fillDocumentsStep,
  fillEmployerStep,
  fillInformationOfPostingStep,
  fillPostedWorkersStep,
  fillSubmittingPersonDataStep,
  fillSubmittingPersonStep } from './lib';

void enter(Targets.Poland, async (targetPosting: TargetPosting<PolishPostingInfo>) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  await fillSubmittingPersonStep(posting.data);
  await fillAttorneyInFactStep(posting.data);
  await fillEmployerStep(posting.data);
  await fillContactDetailsStep(posting.data);
  await fillSubmittingPersonDataStep(posting.data);
  await fillInformationOfPostingStep(posting.data);
  await fillPostedWorkersStep(posting.data, employees);
  await fillContactPersonStep(posting.data);
  await fillDocumentsStep(posting.data);

  void fillingEnd(fillingIsEndMessage);
});
