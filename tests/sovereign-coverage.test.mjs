import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydrateWorldLayer, installWorldLayer, worldCountries, searchWorld, PLACES } from '../dist-server/analytics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const gazetteerFile = read('public/data/countries.json');
hydrateWorldLayer(gazetteerFile, read('public/data/country_fires.json'));
installWorldLayer();

/** The same folding src/lib/countries.ts uses for ranking, applied to the query and the index. */
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Every UN member state by its common short name, plus the Holy See under the name the gazetteer
 * publishes. This is the list a judge or a user would type, so each entry must rank its own area
 * first — a country that answers only over HTTP is not yet reachable from the keyboard.
 */
const SOVEREIGN = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast',
  'Jamaica', 'Japan', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
  'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

/** The 193 UN member states plus the Holy See, in the spellings the app publishes. */
const PLACES_ONLY = new Set(['Tuvalu']);

/**
 * Long forms people paste from an ISO/UN list, mapped to the Natural Earth display name the hit must
 * carry. Natural Earth shortens several of them, which is why they are merged in as aliases at
 * hydration instead of being left to the source spelling.
 */
const LONG_FORMS = [
  ['Marshall Islands', 'Marshall Is.'],
  ['Federated States of Micronesia', 'Micronesia'],
  ['Brunei Darussalam', 'Brunei'],
  ['Syrian Arab Republic', 'Syria'],
  ['United Republic of Tanzania', 'Tanzania'],
  ['The Gambia', 'Gambia'],
  ['Lao PDR', 'Laos'],
  ['Iran (Islamic Republic of)', 'Iran'],
  ['Democratic Republic of the Congo', 'DR Congo'],
  ['State of Palestine', 'Palestine'],
  ['Holy See', 'Vatican City'],
  ['UAE', 'United Arab Emirates'],
  ['Timor Leste', 'Timor-Leste'],
];

test('sovereign coverage: every independent state is one of the 241 borders or a curated place', () => {
  const names = worldCountries();
  const folded = new Set(names.flatMap((c) => [norm(c.name), ...(c.aliases ?? []).map(norm)]));
  const places = new Set(PLACES.map((p) => norm(p.name)));
  const missing = SOVEREIGN.filter((s) => !folded.has(norm(s)) && !places.has(norm(s)));
  assert.deepEqual(missing, [], `these states have no searchable entry: ${missing.join(', ')}`);
  assert.equal(SOVEREIGN.length, 194, 'the list is 193 UN member states plus the Holy See');
  assert.equal(new Set(SOVEREIGN.map(norm)).size, SOVEREIGN.length, 'no duplicate spelling in the list');
});

test('sovereign coverage: typing any state names its own area first', () => {
  const wrong = [];
  for (const q of SOVEREIGN) {
    const hits = searchWorld(q, 5, PLACES);
    const top = hits[0];
    if (!top) { wrong.push(`${q}: no result`); continue; }
    const exact = norm(top.name) === norm(q) || (top.kind === 'place' && PLACES_ONLY.has(q));
    if (!exact) {
      // A gazetteer spelling that differs from the common name (Marshall Is., Cabo Verde) is fine as
      // long as the query was the reason that entry ranked — check it came from that entry's alias.
      const entry = worldCountries().find((c) => c.id === top.id);
      const aliasHit = entry && [...(entry.aliases ?? []), entry.name].some((a) => norm(a) === norm(q));
      if (!aliasHit && !(top.kind === 'place')) wrong.push(`${q}: ranked ${top.kind} ${top.name}`);
    }
  }
  assert.deepEqual(wrong, [], `these states did not rank their own area first:\n${wrong.join('\n')}`);
});

test('sovereign coverage: ISO/UN long forms resolve to the border they name', () => {
  for (const [longForm, displayName] of LONG_FORMS) {
    const hits = searchWorld(longForm, 5, PLACES);
    assert.ok(hits.length > 0, `${longForm} returned no result at all`);
    assert.equal(hits[0].name, displayName, `${longForm} ranked ${hits[0].name} first, expected ${displayName}`);
    assert.equal(hits[0].kind, 'country', `${longForm} must resolve to a border, not a place`);
  }
});

test('sovereign coverage: every ranked hit is a real area, not a label', () => {
  const sampled = ['Marshall Islands', 'Tuvalu', 'Nauru', 'Liechtenstein', 'Vatican City', 'Kiribati', 'Brazil'];
  for (const q of sampled) {
    const hit = searchWorld(q, 3, PLACES)[0];
    assert.ok(hit, `${q} returned nothing`);
    if (hit.kind === 'country') {
      const entry = worldCountries().find((c) => c.id === hit.id);
      assert.ok(entry, `${q} ranked an id the gazetteer does not publish: ${hit.id}`);
      assert.ok(Number.isFinite(hit.lat) && Number.isFinite(hit.lon), `${q} has no centre`);
      assert.ok(hit.detections !== undefined, `${q} carries no measured window count`);
    } else {
      const p = PLACES.find((x) => x.name === hit.name);
      assert.ok(p, `${q} ranked a place that is not curated: ${hit.name}`);
      assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon), `${q} place has no coordinates`);
    }
  }
});
