/** Shared constants */

export const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export const STORAGE = {
  config: 'custom-calendar.oauth',
  accounts: 'custom-calendar.accounts.v3',
  tokens: 'custom-calendar.tokens.v3',
  ui: 'custom-calendar.ui.v4',
};

export const DB = {
  name: 'custom-calendar-db',
  version: 3,
  store: 'events',
};

export const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export const PALETTE = [
  '#7b93ff',
  '#3dd68c',
  '#ffb86b',
  '#ff6b9d',
  '#c4a7ff',
  '#5eead4',
  '#f0abfc',
  '#67e8f9',
];

/** View modes */
export const VIEWS = {
  month: 'month',
  week: 'week',
  list: 'list',
};

/** Hour range for week grid */
export const WEEK_HOUR_START = 0;
export const WEEK_HOUR_END = 24;
export const WEEK_PX_PER_HOUR = 52;

/** Recurrence presets (Google RRULE fragments, without RRULE:) */
export const RECUR_PRESETS = [
  { id: 'none', label: '繰り返しなし', rrule: '' },
  { id: 'daily', label: '毎日', rrule: 'FREQ=DAILY' },
  { id: 'weekdays', label: '平日（月〜金）', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { id: 'weekly', label: '毎週', rrule: 'FREQ=WEEKLY' },
  { id: 'biweekly', label: '隔週', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { id: 'monthly', label: '毎月', rrule: 'FREQ=MONTHLY' },
  { id: 'yearly', label: '毎年', rrule: 'FREQ=YEARLY' },
];

/** Writable calendar roles for create target */
export const WRITABLE_ROLES = new Set(['owner', 'writer', 'writerWithoutPrivateAccess']);

/** Roles that can list event details (events.list). freeBusyReader cannot. */
export const EVENT_READ_ROLES = new Set([
  'owner',
  'writer',
  'writerWithoutPrivateAccess',
  'reader',
]);
