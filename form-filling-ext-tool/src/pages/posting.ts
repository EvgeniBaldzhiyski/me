/* eslint-disable no-invalid-this */
import moment from 'moment';
import { ApiClientError } from '../utils/api.client';
import {
  clearTargetPosting,
  getSelectedPostingId,
  getTargetId,
  getTargetPosting,
  isLogged,
  logout,
  prepareToFilling,
  selectEmployeeIds,
  setTargetPosting,
  waitForCommand
} from '../utils/comm.facade';
import { Commands, TargetId } from '../utils/comm.map';
import { PostingInfo } from '../utils/interfaces';
import { PAGES, goTo } from './utils/route';
import { showError, showNotification } from './utils/noty';
import config from '../utils/config';

let selectedId = '';
let currentTarget: TargetId;
let selectedEmployees: Set<string>;
let targetData: PostingInfo;

function pageBinding() {
  const table = $('#employees_list');

  table.on('draw.dt', () => {
    table.find('[type="checkbox"]').on('change', function() {
      const id = $(this).data('id') as string;
      if (!id) {
        return;
      }

      if ($(this).is(':checked')) {
        selectedEmployees.add(id);
      } else {
        selectedEmployees.delete(id);
      }
      selectEmployeeIds(currentTarget.targetId, Array.from(selectedEmployees));

      $('#fillBtn').prop('disabled', !selectedEmployees.size);
    });
  });

  $('#logout').click(async () => {
    await logout();
    goTo(PAGES.LOGIN);
  });

  $('#backBtn').click(async () => {
    await clearTargetPosting(currentTarget.targetId);

    goTo(PAGES.POSTINGS);
  });

  $('#fillBtn').click(async () => {
    const {accept, error} = await prepareToFilling<{accept: boolean; error?: string}>(currentTarget.targetId);

    if (!accept) {
      return showError(error);
    }

    $('#loadingBoard').show();
  });

  $('#checkAll').on('change', function() {
    if (!targetData) {
      return;
    }

    const checked = $(this).is(':checked');
    const boxes = table.find('[type="checkbox"]');
    for (let i = 0; boxes[i]; i++) {
      $(boxes[i]).prop('checked', checked).change();
    }
  });

  waitForCommand(Commands.END_FILLING, currentTarget.targetId, ({data}) => {
    $('#loadingBoard').hide();
    showNotification(data as string);
  });

  waitForCommand(Commands.SEND_NOTIFICATION, currentTarget.targetId, ({data}) => {
    showNotification(data as string);
  });
}

function initDataTable() {
  const box = $('#employees_list');

  box.dataTable({
    searching: !1,
    lengthChange: !1,
    info: !1,
    autoWidth: !1,
    bPaginate: false,
    scrollY: '210px',
    pagingType: 'simple_numbers',
    pageLength: 6,
    columnDefs: [
      {
        visible: 'never',
        targets: 'dt-hidden',
        searchable: false
      },
      {
        orderable: false,
        targets: 0
      }
    ],
    aoColumnDefs: [
      {
        bSortable: false,
        aTargets: ['sorting_disabled']
      }
    ],
    language: {
      processing: 'Processing...',
      search: 'Search:',
      lengthMenu: '_MENU_',
      info: 'Positions from _START_ to _END_ of _TOTAL_ combined',
      infoEmpty: '0 items out of 0 available',
      infoFiltered: '(filtering from among _MAX_ available items)',
      infoPostFix: '',
      loadingRecords: 'Loading ...',
      zeroRecords: 'No matching items found',
      emptyTable: 'No data',
      paginate: { first: '', previous: '', next: '', last: '' },
      aria: {
        sortAscending: ': activate to sort the column in ascending order',
        sortDescending: ': activate to sort the column in descending order'
      }
    }
  });
}

function showInfoForPosting() {
  const posting = targetData;
  const box = $('#employees_list');
  const table = box.DataTable();

  table.clear();

  $('#ismIdField').text(posting.ismId);
  $('#ismFrom').text(posting.hostStateCountry?.name);
  $('#ismTo').text(posting.postingStateCountry?.name);

  $('#ismStartDateField').text(moment(posting.startDate).format('DD.MM.YYYY'));
  $('#ismEndDateField').text(moment(posting.endDate).format('DD.MM.YYYY'));

  $('#ismBusinessSectorField').text(posting.hostStateCountryBusinessSector.description);

  $('#ismPostingCompanyName').text(posting.postingCompanyName);

  const representList = [];

  for (const item of [
    posting.contactPerson,
    posting.documentPerson,
    posting.recipientPerson,
    posting.reporterPerson,
    posting.representativePerson
  ]) {
    if (item) {
      representList.push(
        `<div>
          <strong>${item.label}:</strong>
          <span>${item.description}</span>
        </div>`
      );
    }
  }

  $('#representativeText').html(representList.join(''));

  for ( const {dateOfBirth, employeeType, firstName, lastName, id} of posting.employees) {
    if (employeeType) {
      continue;
    }

    const displayDate = moment(dateOfBirth).format('DD.MM.YYYY');

    table.row.add([
      `<div class="checkbox-wrapper"><input type="checkbox" data-id="${id}" value="${id}"
        ${selectedEmployees.has(id) ? 'checked' : ''}
      ></div>`,
      firstName,
      lastName,
      displayDate
    ]);
  }

  table.draw();
}

void (async () => {
  const logged = await isLogged();

  if (!logged) {
    return goTo(PAGES.LOGIN);
  }

  currentTarget = await getTargetId();

  if (!currentTarget) {
    return showError('Invalid Target Page');
  }

  initDataTable();
  pageBinding();

  selectedId = await getSelectedPostingId(currentTarget.targetId);

  const {posting, employees} = await getTargetPosting<PostingInfo>(currentTarget.targetId);

  selectedEmployees = new Set(employees || []);

  $('#fillBtn').prop('disabled', !selectedEmployees.size);
  $('#build-version-box').text(config.get('version'));

  let _posting = posting;

  if (_posting?.data?.ismId !== selectedId) {
    _posting = await setTargetPosting(currentTarget.targetId);

    const error = _posting as unknown as ApiClientError;
    if (error.type === 'ApiClientError') {
      _posting.data = undefined;
      showError('The information for the posting is missing. Please try again later.', null, error);
    }
  }

  $('#loadingBoard').hide();

  targetData = _posting.data;

  showInfoForPosting();
})();
