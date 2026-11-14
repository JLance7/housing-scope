const API_ROOT=location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
const stageFetch=(path,options)=>window.homeScopeAuth.fetch(path.startsWith('/api/')?API_ROOT+path:path,options);
const accountMode = Boolean(window.HOMESCOPE_AUTH);
let account = null;
const $=s=>document.querySelector(s),fmt=n=>'$'+Math.round(n||0).toLocaleString();let listings=[],savedOnly=false;
const DEFAULT_CITY = 'Salt Lake City';
const DEFAULT_STATE = 'UT';
const cityKey = 'homescope.cities';
const citySearch = $('#citySearch');
const cityOptions = $('#cityOptions');
const cities = new Map([[DEFAULT_CITY, DEFAULT_STATE]]);
const stateNames = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
let selectedCity = DEFAULT_CITY;
const cityName = value => value.trim().replace(/\s+/g, ' ');
const sameCity = (a, b) => a.toLowerCase() === b.toLowerCase();

function readCities() {
  try {
    const saved = JSON.parse(localStorage.getItem(cityKey));
    return Array.isArray(saved) ? saved.filter(value => typeof value === 'string' && cityName(value)) : [];
  } catch {
    return [];
  }
}

function cityLabel(city) {
  const state = cities.get(city);
  return state ? city + ', ' + state : city;
}

function stateLabel(state) {
  return stateNames[state] || '';
}

function addCityOption(value, state = '') {
  const city = [...cities.keys()].find(name => sameCity(name, value)) ?? value;
  if (cities.has(city) && !state) return city;
  cities.set(city, state);
  cityOptions.replaceChildren(...[...cities.keys()].sort((a, b) => a.localeCompare(b))
    .map(name => new Option([cityLabel(name), stateLabel(cities.get(name))].filter(Boolean).join(' · '), cityLabel(name))));
  return city;
}

function selectCity(value, neighborhood = '') {
  selectedCity = value;
  citySearch.value = cityLabel(value);
  $('#cityStatus').textContent = '';
  changeCity(neighborhood);
}

$('#addCity').onsubmit = event => {
  event.preventDefault();
  const input = $('#cityName');
  const name = cityName(input.value);
  if (!name || sameCity(name, 'all')) {
    $('#cityStatus').textContent = 'Enter a city name.';
    return;
  }
  selectCity(addCityOption(name));
  try {
    localStorage.setItem(cityKey, JSON.stringify([...cities.keys()].filter(city => !cities.get(city))));
    $('#cityStatus').textContent = 'Selected ' + selectedCity + '. Import listings if this city is empty.';
  } catch {
    $('#cityStatus').textContent = 'Selected ' + selectedCity + ' for this session.';
  }
  input.value = '';
};

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function safeSource(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
  } catch {
    return '';
  }
}

let loadVersion = 0;

function updateResultsContext() {
  const city = selectedCity;
  const neighborhood = $('#neighborhood').value;
  $('#resultsTitle').textContent = savedOnly ? 'Saved listings' : 'Listings';
  $('#resultsContext').textContent = neighborhood ? cityLabel(city) + ' · ' + neighborhood : cityLabel(city);
  $('#savedToggle').setAttribute('aria-pressed', String(savedOnly));
  $('#savedToggle').textContent = savedOnly ? 'Show all listings' : 'Saved listings';
  $('#budgetValue').textContent = fmt($('#budget').value);
}

async function load() {
  const version = ++loadVersion;
  updateResultsContext();
  const grid = $('#listingGrid');
  const status = $('#listingStatus');
  grid.setAttribute('aria-busy', 'true');
  $('#empty').hidden = true;
  status.textContent = 'Loading listings…';
  const params = new URLSearchParams({
    budget: $('#budget').value,
    property_type: $('#type').value,
    area: selectedCity,
    q: $('#searchText').value,
    sort: $('#sort').value,
    saved_only: savedOnly,
    neighborhood: $('#neighborhood').value,
    min_rating: $('#minRating').value,
    affordable_only: $('#affordableOnly').checked,
  });
  if ($('#maxPrice').value !== '') params.set('max_price', $('#maxPrice').value);
  const route = accountMode && !account ? '/api/public/listings' : '/api/listings';

  try {
    const response = await stageFetch(route + '?' + params);
    if (!response.ok) throw new Error('Listings could not be loaded.');
    const results = await response.json();
    if (version !== loadVersion) return;
    listings = results;
    status.textContent = '';
    render();
  } catch {
    if (version !== loadVersion) return;
    grid.replaceChildren();
    $('#count').textContent = '';
    status.textContent = 'Listings could not be loaded. Try resetting the filters or refreshing the page.';
  } finally {
    if (version === loadVersion) grid.setAttribute('aria-busy', 'false');
  }
}

function listingCard(item) {
  const sample = item.source === 'Sample data';
  const badge = sample ? 'Sample listing' : item.source === 'RentCast' && item.updated_at
    ? 'Checked ' + item.updated_at : 'Listing';
  const favorite = accountMode && !account ? '' :
    '<button type="button" class="favorite" data-save="' + escapeHtml(encodeURIComponent(item.id)) +
    '" aria-label="Save listing" aria-pressed="' + Boolean(item.favorite) + '">' + (item.favorite ? '♥' : '♡') + '</button>';
  const location = [item.area, item.neighborhood, item.property_type === 'Apartment' ? 'Rental' : 'For sale'].filter(Boolean);
  const source = safeSource(item.source_url);
  return '<article class="listing"><div class="listing-top"><span class="source-badge' + (sample ? ' sample' : '') +
    '">' + escapeHtml(badge) + '</span>' + favorite + '</div><h3>' + escapeHtml(item.title) +
    '</h3><p class="location">' + location.map(escapeHtml).join(' · ') +
    '</p><p class="monthly">' + fmt(item.monthly_cost) + ' <span>est. / month</span></p>' +
    (item.property_type === 'House' ? '<p class="location">Asking price ' + fmt(item.price) + '</p>' : '') +
    '<p class="facts">' + [item.beds ? escapeHtml(item.beds) + ' beds' : '',
      item.baths ? escapeHtml(item.baths) + ' baths' : '',
      item.sqft ? Number(item.sqft).toLocaleString() + ' sq ft' : ''].filter(Boolean).join(' · ') + '</p>' +
    (item.rating_count ? '<p class="muted">Neighborhood rating ' + escapeHtml(item.rating) +
      '/5 (' + escapeHtml(item.rating_count) + ')</p>' : '') +
    (source ? '<a class="source-link" href="' + source + '" target="_blank" rel="noopener">View source listing ↗</a>' : '') +
    '</article>';
}

function render() {
  $('#count').textContent = ' · ' + listings.length + (listings.length === 1 ? ' result' : ' results');
  const empty = $('#empty');
  empty.hidden = listings.length > 0;
  empty.textContent = savedOnly ? 'No saved listings match this search. Select Show all listings to keep exploring.'
    : 'No listings match these filters. Try clearing a filter or increasing your budget.';
  $('#listingGrid').innerHTML = listings.map(listingCard).join('');
  const snapshot = $('#areaBars');
  snapshot.textContent = listings.length
    ? 'Matching listings range from ' + fmt(Math.min(...listings.map(item => item.monthly_cost))) +
      ' to ' + fmt(Math.max(...listings.map(item => item.monthly_cost))) + ' per month.'
    : 'No matching listings for this search.';
}

$('#listingGrid').onclick = async event => {
  const button = event.target.closest('[data-save]');
  if (!button) return;
  button.disabled = true;
  try {
    await feedRequest('/api/listings/' + button.dataset.save + '/favorite', 'POST');
    load();
  } catch (error) {
    $('#listingStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

let timer;
function queueLoad() {
  clearTimeout(timer);
  timer = setTimeout(load, 180);
}
$('#budget').oninput = () => { $('#budgetValue').textContent = fmt($('#budget').value); queueLoad(); };
$('#type').onchange = load;
citySearch.oninput = () => {
  const query = cityName(citySearch.value);
  const match = [...cities.keys()].find(city => sameCity(cityLabel(city), query));
  if (match && match !== selectedCity) selectCity(match);
};
citySearch.onchange = () => {
  const query = cityName(citySearch.value);
  const match = [...cities.keys()].find(city => sameCity(cityLabel(city), query) || sameCity(city, query));
  if (match && match !== selectedCity) selectCity(match);
  else if (match) citySearch.value = cityLabel(match);
  else {
    citySearch.value = cityLabel(selectedCity);
    $('#cityStatus').textContent = 'Choose a city from the suggestions.';
  }
};
$('#searchText').oninput = queueLoad;
$('#sort').onchange = load;
$('#savedToggle').onclick = () => { savedOnly = !savedOnly; load(); };
$('#openShortlist').onclick = () => { $('#apartmentSearch').open = true; };
$('#openLocations').onclick = () => {
  const tools = $('#locationTools');
  $('#settings').open = true;
  tools.open = true;
  tools.querySelector('summary').focus();
  tools.scrollIntoView({ block: 'start' });
};
$('#csvFile').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const result = await feedRequest('/api/import', 'POST', { csv: await file.text() });
    if (result) {
      $('#feedAction').textContent = 'Imported ' + result.imported + ' listings.';
      changeCity($('#neighborhood').value);
    }
  } catch (error) {
    $('#feedAction').textContent = error.message;
  } finally {
    event.target.value = '';
  }
};
$('#clearFilters').onclick = () => {
  $('#budget').value = 2400;
  $('#type').value = 'all';
  $('#searchText').value = '';
  $('#minRating').value = '0';
  $('#maxPrice').value = '';
  $('#affordableOnly').checked = false;
  $('#sort').value = 'cost';
  savedOnly = false;
  changeCity();
};


async function feedRequest(path, method, data) {
  const options = { method, headers: {} };
  if (data) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await stageFetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Check the form and try again.');
  return result;
}

let feedStatusVersion = 0;
async function refreshFeedStatus() {
  if (accountMode && !account?.admin) return;
  const version = ++feedStatusVersion;
  const city = selectedCity;
  const schedule = $('#scheduleCity');
  schedule.disabled = true;
  $('#watchSave').disabled = true;
  $('#feedStatus').textContent = 'Checking daily sync for ' + city + '…';
  try {
    const result = await feedRequest('/api/feed/status?' + new URLSearchParams({ city }), 'GET');
    if (!result || version !== feedStatusVersion) return;
    schedule.checked = result.schedule_enabled;
    schedule.disabled = !result.configured || (accountMode && !account?.admin);
    $('#watchSave').disabled = !result.configured || !result.email_enabled || (accountMode && !account?.admin);
    if (!result.configured) {
      $('#feedStatus').textContent = 'Online listings aren’t configured for ' + city + '.';
      return;
    }
    const status = schedule.checked ? 'Daily sync on for ' : 'Daily sync off for ';
    const runner = result.runner_enabled ? '' : ' The daily runner is not enabled in server settings.';
    const email = result.email_enabled ? '' : ' Email sending is not configured.';
    $('#feedStatus').textContent = status + city + '.' + runner + email;
  } catch (error) {
    if (version === feedStatusVersion) $('#feedStatus').textContent = error.message;
  }
}

$('#scheduleCity').onchange = async event => {
  const box = event.target;
  const city = selectedCity;
  const enabled = box.checked;
  box.disabled = true;
  try {
    const result = await feedRequest('/api/feed/schedule', 'PUT', { city, enabled });
    if (result) $('#feedAction').textContent = enabled ? 'Daily sync enabled for ' + city + '.' : 'Daily sync disabled for ' + city + '.';
  } catch (error) {
    $('#feedAction').textContent = error.message;
  } finally {
    refreshFeedStatus();
  }
};

let rentcastAccount = null;

function showRentcastPanel() {
  $('#settings').open = true;
  $('#rentcastPanel').open = true;
  $('#rentcastKey').focus();
}

async function refreshRentcastAccount() {
  try {
    rentcastAccount = await feedRequest('/api/rentcast/account', 'GET');
    const data = rentcastAccount;
    $('#rentcastUsage').textContent = data.connected
      ? data.free_remaining + ' estimated free requests remaining · ' + data.recent_attempts +
        ' attempts in the past 33 UTC dates · cumulative estimated overage: $' +
        (data.estimated_overage_cents / 100).toFixed(2)
      : 'Connect a key to refresh private listings.';
    $('#disconnectRentcast').hidden = !data.connected;
  } catch (error) {
    $('#rentcastUsage').textContent = error.message;
  }
}

$('#rentcastKeyForm').onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await feedRequest('/api/rentcast/account', 'PUT', {
      api_key: $('#rentcastKey').value, free_remaining: Number($('#rentcastFree').value),
    });
    $('#rentcastStatus').textContent = 'RentCast key saved.';
    await refreshRentcastAccount();
  } catch (error) {
    $('#rentcastStatus').textContent = error.message;
  } finally {
    $('#rentcastKey').value = '';
    button.disabled = false;
  }
};

$('#disconnectRentcast').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await feedRequest('/api/rentcast/account', 'DELETE');
    $('#rentcastStatus').textContent = 'RentCast key removed.';
    await refreshRentcastAccount();
  } catch (error) {
    $('#rentcastStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

function confirmRentcastOverage() {
  const dialog = $('#rentcastOverage');
  const cents = rentcastAccount?.overage_cents_per_request ?? 20;
  $('#rentcastOverageMessage').textContent = 'RentCast could charge $' + (cents / 100).toFixed(2) +
    ' if this request succeeds on the Developer plan.';
  return new Promise(resolve => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

$('#syncFeed').onclick = async event => {
  const button = event.target;
  const city = selectedCity;
  button.disabled = true;
  $('#feedAction').textContent = 'Checking for updated listings in ' + city + '…';
  try {
    if (accountMode && rentcastAccount?.connected === false) {
      showRentcastPanel();
      $('#feedAction').textContent = 'Connect your RentCast key to refresh listings.';
      return;
    }
    const path = '/api/sync?' + new URLSearchParams({ city });
    const data = accountMode ? { property_type: $('#type').value === 'House' ? 'House' : 'Apartment' } : undefined;
    let result = await feedRequest(path, 'POST', data);
    if (result?.confirmation) {
      result = await confirmRentcastOverage()
        ? await feedRequest(path, 'POST', { ...data, confirmed_request: result.confirmation })
        : null;
    }
    if (result?.confirmation) {
      $('#feedAction').textContent = 'Your request balance changed. Start a new refresh to review the cost.';
      return;
    }
    $('#feedAction').textContent = result ? (
      result.updated ? 'Updated ' + result.updated + ' listings.' :
        'No listings updated. The daily or monthly refresh limit may have been reached.'
    ) : 'Update canceled.';
    if (result?.updated) changeCity($('#neighborhood').value);
  } catch (error) {
    $('#feedAction').textContent = error.message;
  } finally {
    if (accountMode) refreshRentcastAccount();
    button.disabled = false;
  }
};

$('#watchForm').onsubmit = async event => {
  event.preventDefault();
  const city = selectedCity;
  const email = $('#watchEmail').value;
  const budget = $('#watchBudget').value;
  try {
    const result = await feedRequest('/api/feed/watch', 'PUT', {
      city, email, budget: budget ? Number(budget) : null,
      keyword: $('#watchKeyword').value, property_type: $('#watchType').value,
      neighborhood: $('#watchNeighborhood').value, alert_hour: Number($('#watchHour').value),
    });
    if (result) $('#feedAction').textContent = result.confirmation_required
      ? 'Email watch saved for ' + city + '. Open the Amazon SNS email and confirm your subscription.'
      : 'Email watch saved for ' + city + '. Alerts are delivered at your selected UTC hour when matches are available.';
  } catch (error) {
    $('#feedAction').textContent = error.message;
  }
};

$('#watchRemove').onclick = async () => {
  if (!accountMode && !$('#watchEmail').reportValidity()) return;
  try {
    const result = await feedRequest('/api/feed/watch', 'DELETE', {
      city: selectedCity, email: $('#watchEmail').value,
    });
    if (result) $('#feedAction').textContent = 'Email watch removed.';
  } catch (error) {
    $('#feedAction').textContent = error.message;
  }
};
$('#marketForm').onsubmit = async event => {
  event.preventDefault();
  try {
    const market = await feedRequest('/api/feed/markets', 'PUT', {
      city: $('#marketCity').value, state: $('#marketState').value,
    });
    if (!market) return;
    selectCity(addCityOption(market.city, market.state));
    $('#feedAction').textContent = market.city + ' added. Include it in daily sync or get updated listings.';
    event.target.reset();
    $('#syncFeed').focus();
  } catch (error) {
    $('#feedAction').textContent = error.message;
  }
};

$('#adminForm').onsubmit = async event => {
  event.preventDefault();
  const enabled = event.submitter?.value === 'grant';
  try {
    await feedRequest('/api/admin/sync-access', 'PUT', { email: $('#adminEmail').value, enabled });
    $('#adminStatus').textContent = enabled ? 'Sync access granted. Ask them to sign in again.' :
      'Sync access removed. An existing token can last up to 15 minutes.';
  } catch (error) {
    $('#adminStatus').textContent = error.message;
  }
};

async function initializeApp() {
  account = await window.homeScopeAuth.ready;
  if (accountMode) {
    const admin = Boolean(account?.admin);
    $('#guestHelp').hidden = Boolean(account);
    $('#emailAccessHelp').hidden = admin;
    $('#emailPanel').hidden = !admin;
    citySearch.disabled = !account;
    $('#syncFeed').hidden = !account;
    $('#marketForm').hidden = !account;
    $('#ownerPanel').hidden = !account?.owner;
    $('#rentcastPanel').hidden = !account;
    if (account) refreshRentcastAccount();
    $('#csvFile').closest('label').hidden = !admin;
    $('#watchRemove').disabled = !account;
    $('#watchEmail').readOnly = true;
    $('#watchEmail').required = false;
    $('#watchEmail').value = account?.email || '';
  } else {
    $('#addCity').hidden = false;
    $('#syncFeed').hidden = false;
    $('#emailPanel').hidden = false;
    $('#csvFile').closest('label').hidden = false;
  }
  const canUseLocations = !accountMode || Boolean(account);
  $('#locationActions').hidden = !canUseLocations;
  $('#locationTools').hidden = !canUseLocations;
  $('#saveLocation').hidden = !accountMode || !account;
  $('#savedToggle').hidden = !canUseLocations;
  if (canUseLocations) readCities().forEach(city => addCityOption(city));
  if (canUseLocations) {
    try {
      const results = await Promise.allSettled([
        feedRequest('/api/feed/markets', 'GET'),
        feedRequest('/api/areas', 'GET'),
      ]);
      const [markets, areas] = results;
      if (markets.status === 'fulfilled') {
        for (const market of markets.value) addCityOption(market.city, market.state);
      }
      if (areas.status === 'fulfilled') {
        for (const area of areas.value) addCityOption(area.name);
      }
      if (results.some(result => result.status === 'rejected')) {
        $('#feedAction').textContent = 'Some city suggestions could not be loaded.';
      }
    } catch (error) {
      $('#feedAction').textContent = error.message;
    }
  }
  if (accountMode && account) {
    $('#accountLocations').hidden = false;
    try { await refreshSavedLocations(); } catch (error) { $('#cityStatus').textContent = error.message; }
  }
  addCityOption(DEFAULT_CITY, DEFAULT_STATE);
  changeCity();
}
let savedLocations = [];
let neighborhoodVersion = 0;

function updateLocationControls() {
  const city = selectedCity;
  const neighborhood = $('#neighborhood').value;
  const saved = savedLocations.some(place => sameCity(place.city, city) && sameCity(place.neighborhood, neighborhood));
  $('#saveLocation').textContent = saved ? 'Remove saved location' : 'Save this location';
  $('#saveLocation').setAttribute('aria-pressed', String(saved));
  $('#submitRating').disabled = !neighborhood;
  return saved;
}

async function refreshSavedLocations() {
  savedLocations = await feedRequest('/api/locations', 'GET');
  const picker = $('#savedLocations');
  picker.replaceChildren(new Option('Choose a saved location', ''));
  savedLocations.forEach((place, index) => picker.add(new Option(
    place.neighborhood ? place.city + ' · ' + place.neighborhood : place.city, String(index)
  )));
  updateLocationControls();
}

async function changeCity(selected = '') {
  const version = ++neighborhoodVersion;
  ++loadVersion;
  const city = selectedCity;
  const filter = $('#neighborhood');
  const options = $('#neighborhoodOptions');
  const watch = $('#watchNeighborhood');
  filter.value = selected;
  options.replaceChildren();
  watch.replaceChildren(new Option('Any', ''));
  updateLocationControls();
  refreshFeedStatus();
  try {
    const route = accountMode && !account ? '/api/public/neighborhoods' : '/api/neighborhoods';
    const data = await feedRequest(route + '?' + new URLSearchParams({ area: city }), 'GET');
    if (version !== neighborhoodVersion) return;
    for (const row of data) {
      const label = row.rating_count ? row.name + ' · ' + row.rating + '★' : row.name;
      options.append(new Option(label, row.name));
      watch.add(new Option(row.name, row.name));
    }
  } catch {
    if (version !== neighborhoodVersion) return;
  }
  updateLocationControls();
  load();
}

$('#saveLocation').onclick = async () => {
  const saved = !updateLocationControls();
  try {
    await feedRequest('/api/locations', 'PUT', { city: selectedCity, neighborhood: $('#neighborhood').value, saved });
    await refreshSavedLocations();
    $('#cityStatus').textContent = saved ? 'Location saved to your account.' : 'Location removed.';
  } catch (error) {
    $('#cityStatus').textContent = error.message;
  }
};
$('#savedLocations').onchange = event => {
  if (event.target.value === '') return;
  const place = savedLocations[Number(event.target.value)];
  selectCity(addCityOption(place.city), place.neighborhood);
  citySearch.focus();
};
$('#ratingForm').onsubmit = async event => {
  event.preventDefault();
  const neighborhood = $('#neighborhood').value;
  try {
    await feedRequest('/api/neighborhoods/rating', 'PUT', {
      city: selectedCity, neighborhood, stars: Number($('#ratingStars').value),
    });
    $('#cityStatus').textContent = 'Your neighborhood rating was saved.';
    changeCity(neighborhood);
  } catch (error) {
    $('#cityStatus').textContent = error.message;
  }
};
$('#neighborhood').oninput = () => { updateLocationControls(); queueLoad(); };
$('#stateOptions').replaceChildren(...Object.entries(stateNames).map(([code, name]) => new Option(name, code)));
$('#minRating').onchange = load;
$('#maxPrice').onchange = load;
$('#affordableOnly').onchange = load;
for (let hour = 0; hour < 24; hour++) {
  $('#watchHour').add(new Option(String(hour).padStart(2, '0') + ':00 UTC', String(hour), hour === 11, hour === 11));
}

function initializeApartmentSearch() {
  const storageKey = 'homescope.apartmentSearch';
  const grades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
  const areaForm = $('#rentalAreaForm');
  const listingForm = $('#rentalListingForm');
  const areaEditor = $('#rentalAreaEditor');
  const listingEditor = $('#rentalListingEditor');
  const areaFilter = $('#rentalAreaFilter');
  const listingArea = $('#rentalListingArea');
  const priceFilter = $('#rentalPriceFilter');
  const ratingFilter = $('#rentalRatingFilter');
  const gradeFilter = $('#rentalGradeFilter');
  const feedback = $('#rentalFeedback');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  let areaId = '';
  let listingId = '';
  let data = { areas: [{ id: 'salt-lake-city-ut', place: DEFAULT_CITY, state: DEFAULT_STATE, rating: '', grade: '', safety: '' }], rentals: [] };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.areas) && Array.isArray(saved.rentals)) data = saved;
  } catch {
    feedback.textContent = 'Saved apartment searches could not be loaded.';
  }

  grades.forEach(grade => {
    $('#rentalGradeEntry').add(new Option(grade, grade));
    gradeFilter.add(new Option(grade + ' or higher', grade));
  });

  const areaLabel = area => [area.neighborhood, area.place, area.state].filter(Boolean).join(', ');
  const gradeRank = area => {
    const rank = grades.indexOf(area.grade);
    return rank < 0 ? grades.length : rank;
  };
  const knownCost = rental => Math.round((rental.rent + (rental.fees ?? 0)) * 100) / 100;
  const httpsUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  };
  const link = (url, label) => '<a class="source-link" href="' + escapeHtml(url) +
    '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + ' ↗</a>';

  function areaCard(area, max) {
    const slug = /^\d{5}$/.test(area.place) ? area.place : (area.place + '-' + area.state)
      .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nicheSearch = new URL('https://www.google.com/search');
    nicheSearch.searchParams.set('q', 'site:niche.com/places-to-live/ ' + areaLabel(area));
    const apartmentsPath = max ? slug + '/under-' + Math.floor(max) + '/' : slug + '/';
    const safety = httpsUrl(area.safety);
    return '<article class="listing"><h3>' + escapeHtml(areaLabel(area)) + '</h3>' +
      '<p class="location">Your rating ' + (area.rating ? escapeHtml(area.rating) + '/5' : '—') +
      ' · Niche grade ' + (area.grade ? escapeHtml(area.grade) + ' (your notes)' : '—') + '</p>' +
      '<div class="button-row">' +
      link('https://www.zillow.com/' + slug + '/rentals/', 'Zillow rentals') +
      link('https://www.apartments.com/' + apartmentsPath, 'Apartments.com') +
      link(nicheSearch.href, 'Find Niche profile') +
      (safety ? link(safety.href, 'Safety report') : '') + '</div>' +
      '<div class="button-row"><button class="button secondary" data-edit-area="' + escapeHtml(area.id) +
      '">Edit area</button><button class="button quiet" data-add-rental="' + escapeHtml(area.id) +
      '">Save a rental</button></div></article>';
  }

  function rentalCard(rental, area) {
    const url = httpsUrl(rental.url);
    return '<article class="listing"><h3>' + escapeHtml(rental.title) + '</h3><p class="location">' +
      escapeHtml(areaLabel(area)) + '</p><p class="monthly">' + money.format(knownCost(rental)) +
      (rental.fees === null ? ' <span>known / month</span>' : ' <span>/ month</span>') +
      '</p><p class="facts">Rent ' + money.format(rental.rent) +
      ' · ' + (rental.fees === null ? 'Monthly fees unknown' : 'Monthly fees ' + money.format(rental.fees)) +
      ' · ' + (rental.moveIn === null ? 'Move-in cash unknown' : 'Move-in cash ' + money.format(rental.moveIn)) +
      '</p>' + (url ? link(url.href, 'Open listing on ' + url.hostname.replace(/^www\./, '')) : '') +
      '<div class="button-row"><button class="button secondary" data-edit-rental="' + escapeHtml(rental.id) +
      '">Edit</button><button class="button quiet" data-remove-rental="' + escapeHtml(rental.id) +
      '">Remove</button></div></article>';
  }

  function renderShortlist() {
    const max = priceFilter.validity.valid ? Number(priceFilter.value) : 0;
    const minGrade = grades.indexOf(gradeFilter.value);
    const matchingAreas = data.areas.filter(area => {
      const grade = grades.indexOf(area.grade);
      return (!areaFilter.value || area.id === areaFilter.value) &&
        (!ratingFilter.value || Number(area.rating) >= Number(ratingFilter.value)) &&
        (minGrade < 0 || (grade >= 0 && grade <= minGrade));
    }).sort((a, b) => gradeRank(a) - gradeRank(b) || areaLabel(a).localeCompare(areaLabel(b)));
    const areas = new Map(matchingAreas.map(area => [area.id, area]));
    const rentals = data.rentals.filter(rental => areas.has(rental.area) && (!max || knownCost(rental) <= max))
      .sort((a, b) => knownCost(a) - knownCost(b));
    const costs = new Map();
    for (const rental of rentals) {
      const summary = costs.get(rental.area) ?? { count: 0, lowest: knownCost(rental) };
      summary.count++;
      costs.set(rental.area, summary);
    }
    $('#rentalAreaComparison').innerHTML = matchingAreas.length
      ? matchingAreas.map(area => {
        const summary = costs.get(area.id);
        return '<tr><th scope="row">' + escapeHtml(areaLabel(area)) + '</th><td>' +
          (gradeRank(area) === grades.length ? 'Unrated' : escapeHtml(area.grade)) +
          '</td><td>' + (area.rating ? escapeHtml(area.rating) + '/5' : '—') +
          '</td><td>' + (summary?.count ?? 0) + '</td><td>' +
          (summary ? money.format(summary.lowest) : '—') + '</td></tr>';
      }).join('')
      : '<tr><td colspan="5">No areas match your filters.</td></tr>';
    $('#rentalAreas').innerHTML = matchingAreas.length
      ? matchingAreas.map(area => areaCard(area, max)).join('')
      : '<p class="muted">No areas match these rating filters. Edit an area or clear a filter.</p>';
    $('#rentalShortlist').innerHTML = rentals.map(rental => rentalCard(rental, areas.get(rental.area))).join('');
    $('#rentalCount').textContent = rentals.length
      ? rentals.length + ' saved ' + (rentals.length === 1 ? 'rental' : 'rentals') + ' match. Price uses rent plus any fees you entered.'
      : data.rentals.length ? 'No saved rentals match these filters.' : 'Open a rental search above, then save a listing link here.';
  }

  function updateAreaOptions() {
    const selectedFilter = areaFilter.value;
    const selectedArea = listingArea.value;
    areaFilter.replaceChildren(new Option('All areas', ''),
      ...data.areas.map(area => new Option(areaLabel(area), area.id)));
    listingArea.replaceChildren(...data.areas.map(area => new Option(areaLabel(area), area.id)));
    areaFilter.value = selectedFilter;
    if (selectedArea) listingArea.value = selectedArea;
  }

  function save(next, message) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      feedback.textContent = 'This browser could not save your changes.';
      return false;
    }
    data = next;
    updateAreaOptions();
    renderShortlist();
    feedback.textContent = message;
    return true;
  }

  function closeArea() {
    areaId = '';
    areaForm.reset();
    $('#rentalAreaSummary').textContent = 'Add an area';
    areaEditor.open = false;
  }

  function closeRental() {
    listingId = '';
    listingForm.reset();
    $('#rentalListingSummary').textContent = 'Save a rental by link';
    listingEditor.open = false;
  }

  areaForm.onsubmit = event => {
    event.preventDefault();
    const entry = Object.fromEntries(new FormData(areaForm));
    entry.place = cityName(entry.place);
    entry.neighborhood = cityName(entry.neighborhood);
    entry.state = entry.state.toUpperCase();
    if (!/[\p{L}\p{N}]/u.test(entry.place) || (entry.safety && !httpsUrl(entry.safety))) {
      feedback.textContent = 'Enter a city, town, or ZIP and use an HTTPS link for the safety report.';
      return;
    }
    if (data.areas.some(area => area.id !== areaId && sameCity(area.place, entry.place) &&
        area.state === entry.state && sameCity(area.neighborhood ?? '', entry.neighborhood))) {
      feedback.textContent = 'That area is already on your shortlist.';
      return;
    }
    const area = { ...entry, id: areaId || crypto.randomUUID() };
    const areas = areaId ? data.areas.map(item => item.id === areaId ? area : item) : [...data.areas, area];
    if (save({ ...data, areas }, areaLabel(area) + ' saved.')) closeArea();
  };

  listingForm.onsubmit = event => {
    event.preventDefault();
    const entry = Object.fromEntries(new FormData(listingForm));
    const url = httpsUrl(entry.url);
    const title = entry.title.trim();
    if (!url || !title || !data.areas.some(area => area.id === entry.area)) {
      feedback.textContent = 'Enter an HTTPS listing link, a name, and an area.';
      return;
    }
    const rental = { ...entry, id: listingId || crypto.randomUUID(), url: url.href, title, rent: Number(entry.rent),
      fees: entry.fees === '' ? null : Number(entry.fees), moveIn: entry.moveIn === '' ? null : Number(entry.moveIn) };
    const rentals = listingId ? data.rentals.map(item => item.id === listingId ? rental : item) : [...data.rentals, rental];
    if (save({ ...data, rentals }, title + ' saved.')) closeRental();
  };

  function openRental(id, area) {
    closeRental();
    listingId = id;
    const rental = data.rentals.find(item => item.id === id);
    if (rental) {
      for (const field of ['url', 'title', 'area', 'rent', 'fees', 'moveIn']) {
        listingForm.elements.namedItem(field).value = rental[field] ?? '';
      }
      $('#rentalListingSummary').textContent = 'Edit saved rental';
    } else {
      listingArea.value = area || areaFilter.value || data.areas[0]?.id || '';
    }
    listingEditor.open = true;
    listingForm.elements.namedItem('url').focus();
  }

  $('#rentalAreas').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.addRental) {
      openRental('', button.dataset.addRental);
      return;
    }
    const area = data.areas.find(item => item.id === button.dataset.editArea);
    if (!area) return;
    areaId = area.id;
    for (const field of ['place', 'state', 'neighborhood', 'rating', 'grade', 'safety']) {
      areaForm.elements.namedItem(field).value = area[field] ?? '';
    }
    $('#rentalAreaSummary').textContent = 'Edit area';
    areaEditor.open = true;
    areaForm.elements.namedItem('place').focus();
  };

  $('#rentalShortlist').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.editRental) openRental(button.dataset.editRental);
    if (button.dataset.removeRental) {
      const rentals = data.rentals.filter(item => item.id !== button.dataset.removeRental);
      if (save({ ...data, rentals }, 'Rental removed.') && listingId === button.dataset.removeRental) closeRental();
    }
  };

  $('#cancelRentalArea').onclick = closeArea;
  $('#cancelRentalListing').onclick = closeRental;
  for (const control of [areaFilter, ratingFilter, gradeFilter, priceFilter]) {
    control.addEventListener('input', renderShortlist);
  }
  updateAreaOptions();
  renderShortlist();
}

initializeApartmentSearch();
initializeApp();
