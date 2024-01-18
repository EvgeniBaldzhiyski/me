export enum PAGES {
  LOGIN = 'login.html',
  POSTING = 'posting.html',
  POSTINGS = 'postings.html'
}

export function goTo(page: PAGES) {
  window.location.href = `./${page}`;
}
