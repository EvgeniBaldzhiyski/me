/* eslint-disable no-invalid-this */
import moment from 'moment';
import { ApiClientError } from '../utils/api.client';
import {
  getPostings,
  getTargetId,
  getTargetPosting,
  isLogged,
  logout,
  selectPosting,
} from '../utils/comm.facade';
import { PostingItem } from '../utils/interfaces';
import { PAGES, goTo } from './utils/route';
import { showError } from './utils/noty';
import { TargetId } from '../utils/comm.map';
import config from '../utils/config';

let selectedId = '';
let currentTarget: TargetId;

function pageBinding() {
  const box = $('#postings_list');
  const viewBtn = $('#viewSelectPosting');

  box.on('draw.dt', () => {
    box.find('[type="radio"]').on('change', function() {
      if ($(this).is(':checked')) {
        selectedId = $(this).data('id');
      } else {
        selectedId = '';
      }

      selectPosting(currentTarget.targetId, selectedId);
      viewBtn.prop('disabled', !selectedId);
    });
  });

  viewBtn.click(() => {
    if (!viewBtn.prop('disabled')) {
      goTo(PAGES.POSTING);
    }
  });

  $('#refreshPostings').click(() => {
    // eslint-disable-next-line no-use-before-define
    void processPostings(true);
  });

  $('#logout').click(async () => {
    await logout();
    goTo(PAGES.LOGIN);
  });
}

function initDataTable() {
  $('#postings_list').dataTable({
    searching: !1,
    lengthChange: !1,
    info: !1,
    autoWidth: !1,
    bPaginate: false,
    scrollY: '240px',
    pagingType: 'simple_numbers',
    pageLength: 6,
    columnDefs: [
      {
        visible: 'never',
        targets: 'dt-hidden',
        searchable: false,
        // className: 'dt-body-right'
      },
      {
        orderable: false,
        targets: 0,
      },
    ],
    aoColumnDefs: [
      {
        bSortable: false,
        aTargets: ['sorting_disabled'],
      },
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
        sortDescending: ': activate to sort the column in descending order',
      },
    },
  });
}

function showPostings(postings: PostingItem[]) {
  const box = $('#postings_list');
  const viewBtn = $('#viewSelectPosting');

  const table = box.DataTable();
  let hasMatch = false;

  table.clear();

  for (const posting of postings) {
    const startDate = moment(posting.startDate).format('DD.MM.YYYY');
    const endDate = moment(posting.endDate).format('DD.MM.YYYY');
    const employees = posting.employees.filter((e) => !e.employeeType).length;
    const checkbox = `
      <div class="checkbox-wrapper">
        <input type="radio"
          data-id="${posting.ismId}"
          value="${posting.ismId}"
          name="postingsRadio"
          ${selectedId === posting.ismId && 'checked'}
        >
      </div>
    `;

    if (selectedId === posting.ismId) {
      hasMatch = true;
    }

    table.row.add([
      checkbox,
      posting.ismId,
      posting.hostCompanyDistrictName,
      startDate,
      endDate,
      employees,
    ]);
  }

  viewBtn.prop('disabled', !hasMatch);

  table.draw();
}

async function processPostings(refresh = false) {
  $('#loadingBoard').show();

  const res = await getPostings(currentTarget.targetId, refresh);
  let postings = res.postings;

  selectedId = res.selectedId;

  const error = res as unknown as ApiClientError;
  if (error.type === 'ApiClientError') {
    if (error.code === 401) {
      return showError('Session is expired', () => goTo(PAGES.LOGIN), error);
    }
    postings = [];
    showError('Internal server error, please try again later.', null, error);
  }

  showPostings(postings);
  $('#loadingBoard').hide();
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

  if (currentTarget.error) {
    return showError(currentTarget.error);
  }

  const { posting } = await getTargetPosting(currentTarget.targetId);

  if (posting) {
    return goTo(PAGES.POSTING);
  }

  $('#build-version-box').text(config.get('version'));

  initDataTable();
  pageBinding();

  void processPostings();
})();
