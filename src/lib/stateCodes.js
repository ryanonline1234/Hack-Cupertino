// Census state FIPS code -> USPS abbreviation: 50 states, DC, Puerto Rico and
// the island areas (74 = U.S. Minor Outlying Islands).
export const STATE_ABBR_BY_FIPS = Object.freeze({
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
  '60': 'AS',
  '66': 'GU',
  '69': 'MP',
  '72': 'PR',
  '74': 'UM',
  '78': 'VI',
});

// Accepts the 2-digit string ('06') or the number (6). Anything else — a
// county or tract GEOID included — returns null rather than a wrong state.
export function stateAbbrFromFips(fips) {
  let key;
  if (typeof fips === 'number' && Number.isInteger(fips) && fips > 0 && fips < 100) {
    key = String(fips).padStart(2, '0');
  } else if (typeof fips === 'string' && /^\d{2}$/.test(fips)) {
    key = fips;
  } else {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(STATE_ABBR_BY_FIPS, key) ? STATE_ABBR_BY_FIPS[key] : null;
}
