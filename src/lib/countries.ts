/**
 * ISO 3166-1 alpha-2 country codes.
 * Names are resolved at runtime via Intl.DisplayNames so they
 * automatically reflect the active UI language (en / ar).
 */

const ISO_CODES: string[] = [
  'AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ',
  'BS','BH','BD','BB','BY','BE','BZ','BJ','BT','BO','BA','BW','BR','BN','BG','BF','BI',
  'CV','KH','CM','CA','CF','TD','CL','CN','CO','KM','CG','CD','CR','HR','CU','CY','CZ',
  'DK','DJ','DM','DO',
  'EC','EG','SV','GQ','ER','EE','SZ','ET',
  'FJ','FI','FR',
  'GA','GM','GE','DE','GH','GR','GD','GT','GN','GW','GY',
  'HT','HN','HU',
  'IS','IN','ID','IR','IQ','IE','IL','IT',
  'JM','JP','JO',
  'KZ','KE','KI','KP','KR','KW','KG',
  'LA','LV','LB','LS','LR','LY','LI','LT','LU',
  'MG','MW','MY','MV','ML','MT','MH','MR','MU','MX','FM','MD','MC','MN','ME','MA','MZ','MM',
  'NA','NR','NP','NL','NZ','NI','NE','NG','NO',
  'OM',
  'PK','PW','PA','PG','PY','PE','PH','PL','PT',
  'QA',
  'RO','RU','RW',
  'KN','LC','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SK','SI','SB','SO','ZA','SS','ES','LK','SD','SR','SE','CH','SY',
  'TW','TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM','TV',
  'UG','UA','AE','GB','US','UY','UZ',
  'VU','VE','VN',
  'YE',
  'ZM','ZW',
];

export interface Country {
  code: string;
  name: string;
}

/**
 * Returns all countries sorted alphabetically in the requested language.
 * Uses Intl.DisplayNames so no static translation table is needed.
 */
export function getCountries(lang: 'en' | 'ar'): Country[] {
  const locale = lang === 'ar' ? 'ar' : 'en';
  const dn = new Intl.DisplayNames([locale], { type: 'region' });
  return ISO_CODES
    .map(code => ({ code, name: dn.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
