import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { enter } from '../utils/simplify-api';
import { AustriaPostingInfo, localNeedsState } from './interfaces';
import { runStep0, runStep1, runStep2, runStep3 } from './lib';

// eslint-disable-next-line max-len
// https://www4.formularservice.gv.at/formularserver/user/formular.aspx?pid=fe66cedb506e495c94b3e826701443e5&pn=B461f73088ab946fe9bd1d1cce573d81a&lang=en

void enter(Targets.Austria, (targetPosting: TargetPosting<AustriaPostingInfo, localNeedsState>) => {
  const {posting, employees} = targetPosting;

  if (!posting) {
    return;
  }
  const { data, state } = posting;

  switch (state.step) {
    case 0: {
      void runStep0(data);
      break;
    }
    case 1: {
      void runStep1(data, state.location);
      break;
    }
    case 2: {
      void runStep2(data, (state.employeeIndex || 0), employees);
      break;
    }
    case 3: {
      runStep3();
      break;
    }
  }
});
