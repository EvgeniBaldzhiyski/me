import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import config from '../../utils/config';
import { PostingInfo } from '../../utils/interfaces';
import { element } from '../utils/dom';
import { enter } from '../utils/simplify-api';
import { localNeedsState } from './interfaces';
import { step0, step1, step2, step3, step4, step5, step6 } from './lib';

void enter(
  Targets.Germany,
  () => {
    try {
      element('#lip_segment-instance:Seite1:header:Seite1Kopfzeile1');
    } catch(error) {
      return { error: config.get<string>(`targets.${window.currentTarget}.invalidEntryPoint`) };
    }

    return {};
  },
  (targetPosting: TargetPosting<PostingInfo, localNeedsState>) => {
    const {posting, employees} = targetPosting;

    if (!posting) {
      return;
    }

    const data = {
      postingData: posting.data,
      postingState: posting.state,
      selectEmployeeIds: employees,
    };

    switch(data.postingState.step) {
      case 0: {
        void step0(data);
        break;
      }
      case 1: {
        void step1(data);
        break;
      }
      case 2: {
        void step2(data);
        break;
      }
      case 3: {
        void step3(data);
        break;
      }
      case 4: {
        void step4(data);
        break;
      }
      case 5: {
        void step5(data);
        break;
      }
      case 6: {
        void step6(data);
        break;
      }
    }
  }
);
