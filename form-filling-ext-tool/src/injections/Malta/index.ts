import { Targets } from '../../targets.enum';
import { TargetPosting } from '../../utils/comm.map';
import { element, onMutation } from '../utils/dom';
import { fillingIsEndMessage } from '../utils/labels';
import {
  enter,
  fillingEnd,
  setPostingState,
  // setPostingState
} from '../utils/simplify-api';
import { MaltaPostingInfo } from './interfaces';
import {
  attachments,
  detailsAboutSendingParty,
  detailsOfPostedWorker,
  detailsOfSpecialPersons,
  detailsOfUndertakingInMalta,
  natureOfPosting,
  setupLanguage
} from './lib';

void enter(Targets.Malta, async (targetPosting: TargetPosting<MaltaPostingInfo>) => {
  const { posting, employees } = targetPosting;

  if (!posting) {
    return;
  }

  const step = posting.state.step || 0;
  const employeeId = employees[step];
  const {data} = posting;

  if (employeeId) {
    console.log('DATA -> ', data);

    // wait all resources to be loaded (autocomplete containers)
    if (element('.ajaxLoader', true)) {
      await onMutation(document.body, () => !element('.ajaxLoader', true));
    }

    await setupLanguage();

    natureOfPosting(data);

    await detailsAboutSendingParty(data);

    detailsOfSpecialPersons(data);
    detailsOfUndertakingInMalta(data);

    const employee = {
      ...data.employees.find(e => e.id === employeeId),
      ...data.employeeAdditionalInfo.find(info => info.employeeId === employeeId),
    };

    await detailsOfPostedWorker(employee);
    await attachments(employee);

    if (!employees[step + 1]) {
      void fillingEnd(fillingIsEndMessage);
      setTimeout(() => alert(fillingIsEndMessage), 1000);
      return;
    }

    await setPostingState({step: step + 1});

    setTimeout(() => alert('Please verify the information before submitting and continue with the next employee.'), 1000);

    await onMutation(document.body, () => {
      if (element('.popupManager .info', true)) {
        document.querySelector<HTMLElement>('.close').style.display = 'none';

        const popupFooter = element('.popup-footer');
        // eslint-disable-next-line no-self-assign
        popupFooter.innerHTML = popupFooter.innerHTML;

        window.addEventListener('click', () => window.location.reload());
        return true;
      }
      return false;
    });

    return;
  }

  void fillingEnd(fillingIsEndMessage);
});
