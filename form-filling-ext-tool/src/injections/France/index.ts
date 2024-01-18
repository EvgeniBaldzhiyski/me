import { TargetPosting, TargetDataState } from '../../utils/comm.map';
import { enter, fillingEnd } from '../utils/simplify-api';
import { fillingIsEndMessage } from '../utils/labels';
import { Targets } from '../../targets.enum';
import { FrancePostingInfo } from './interfaces';
import { foreignCompany, infoService, postingEmployees, recipientCompany, representativePerson, serviceSites } from './lib';

void enter(Targets.France, async (targetPosting: TargetPosting<FrancePostingInfo, TargetDataState>) => {
  const {posting, employees} = targetPosting;
  if (!posting) {
    return;
  }

  const { data } = posting;

  await foreignCompany(data);
  await recipientCompany(data);
  await serviceSites(data);
  await infoService(data);
  await postingEmployees(data, employees);
  await representativePerson(data);

  void fillingEnd(fillingIsEndMessage);
});
