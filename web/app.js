const API_ROOT=location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
const stageFetch=(path,options)=>window.homeScopeAuth.fetch(path.startsWith('/api/')?API_ROOT+path:path,options);
const accountMode = Boolean(window.HOMESCOPE_AUTH);
let account = null;
const $=s=>document.querySelector(s),fmt=n=>'$'+Math.round(n||0).toLocaleString();let listings=[],savedOnly=false;
const DEFAULT_CITY = 'White Plains';
const cityKey = 'homescope.cities';
const citySelect = $('#area');
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

function addCityOption(value) {
  const existing = [...citySelect.options].find(option => sameCity(option.value, value));
  if (existing) return existing.value;
  citySelect.add(new Option(value, value));
  return value;
}

$('#addCity').onsubmit = event => {
  event.preventDefault();
  const input = $('#cityName');
  const name = cityName(input.value);
  if (!name || sameCity(name, 'all')) {
    $('#cityStatus').textContent = 'Enter a city name.';
    return;
  }
  citySelect.value = addCityOption(name);
  try {
    localStorage.setItem(cityKey, JSON.stringify([...citySelect.options].slice(1).map(option => option.value)));
    $('#cityStatus').textContent = 'Selected ' + citySelect.value + '. Import listings if this city is empty.';
  } catch {
    $('#cityStatus').textContent = 'Selected ' + citySelect.value + ' for this session.';
  }
  input.value = '';
  changeCity();
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
  const city = citySelect.value;
  const neighborhood = $('#neighborhood').value;
  $('#currentCity').textContent = city === DEFAULT_CITY ? 'White Plains, NY' : city;
  $('#resultsTitle').textContent = savedOnly ? 'Saved listings' : 'Listings';
  $('#resultsContext').textContent = neighborhood ? city + ' · ' + neighborhood : city;
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
    area: citySelect.value,
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
    for (const id of ['count', 'affordableCount', 'avgPayment']) $('#' + id).textContent = '—';
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
  const budget = Number($('#budget').value);
  $('#count').textContent = listings.length;
  $('#affordableCount').textContent = listings.filter(item => item.monthly_cost <= budget).length;
  $('#avgPayment').textContent = listings.length
    ? fmt(listings.reduce((total, item) => total + item.monthly_cost, 0) / listings.length) : '—';
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
citySelect.onchange = () => changeCity();
$('#searchText').oninput = queueLoad;
$('#sort').onchange = load;
$('#savedToggle').onclick = () => { savedOnly = !savedOnly; load(); };
$('#guestSignIn').onclick = () => $('#signIn').click();
$('#openLocations').onclick = () => {
  const tools = $('#locationTools');
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


function syncToken(){return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML='<form method="dialog"><label>HomeScope admin token<input type="password" name="token" autocomplete="off" required></label><button value="sync">Sync feed</button><button type="button" data-cancel>Cancel</button></form>';dialog.querySelector('[data-cancel]').onclick=()=>dialog.close('cancel');dialog.addEventListener('close',()=>{const token=dialog.returnValue==='sync'?dialog.querySelector('input').value:null;dialog.remove();resolve(token);},{once:true});document.body.appendChild(dialog);dialog.showModal();dialog.querySelector('input').focus();});}

async function feedRequest(path, method, data) {
  const options = { method, headers: {} };
  if (data) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  let response = await stageFetch(path, options);
  if (response.status === 401 && !accountMode) {
    const token = await syncToken();
    if (!token) return null;
    options.headers['X-Admin-Token'] = token;
    response = await stageFetch(path, options);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Check the form and try again.');
  return result;
}

let feedStatusVersion = 0;
async function refreshFeedStatus() {
  if (accountMode && !account?.admin) return;
  const version = ++feedStatusVersion;
  const city = citySelect.value;
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
  const city = citySelect.value;
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

$('#syncFeed').onclick = async event => {
  const button = event.target;
  const city = citySelect.value;
  button.disabled = true;
  $('#feedAction').textContent = 'Checking for updated listings in ' + city + '…';
  try {
    const result = await feedRequest('/api/sync?' + new URLSearchParams({ city }), 'POST');
    $('#feedAction').textContent = result ? (
      result.updated ? 'Updated ' + result.updated + ' listings.' :
        'No listings updated. The manual refresh limit may have been reached.'
    ) : 'Update canceled.';
    if (result?.updated) changeCity($('#neighborhood').value);
  } catch (error) {
    $('#feedAction').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$('#watchForm').onsubmit = async event => {
  event.preventDefault();
  const city = citySelect.value;
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
      city: citySelect.value, email: $('#watchEmail').value,
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
    citySelect.value = addCityOption(market.city);
    $('#feedAction').textContent = market.city + ' added. Include it in daily sync or get updated listings.';
    event.target.reset();
    changeCity();
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
    citySelect.disabled = !account;
    $('#syncFeed').hidden = !account;
    $('#marketForm').hidden = !account;
    $('#ownerPanel').hidden = !account?.owner;
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
  if (canUseLocations) readCities().forEach(addCityOption);
  if (accountMode && account) {
    try {
      const markets = await feedRequest('/api/feed/markets', 'GET');
      for (const market of markets) addCityOption(market.city);
    } catch (error) {
      $('#feedAction').textContent = error.message;
    }
  }
  if (accountMode && account) {
    $('#accountLocations').hidden = false;
    try { await refreshSavedLocations(); } catch (error) { $('#cityStatus').textContent = error.message; }
  }
  changeCity();
}
let savedLocations = [];
let neighborhoodVersion = 0;

function updateLocationControls() {
  const city = citySelect.value;
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
  const city = citySelect.value;
  const filter = $('#neighborhood');
  const watch = $('#watchNeighborhood');
  filter.replaceChildren(new Option('All neighborhoods and ZIPs', ''));
  watch.replaceChildren(new Option('Any', ''));
  updateLocationControls();
  refreshFeedStatus();
  try {
    const route = accountMode && !account ? '/api/public/neighborhoods' : '/api/neighborhoods';
    const data = await feedRequest(route + '?' + new URLSearchParams({ area: city }), 'GET');
    if (version !== neighborhoodVersion) return;
    for (const row of data) {
      const label = row.rating_count ? row.name + ' · ' + row.rating + '★' : row.name;
      filter.add(new Option(label, row.name));
      watch.add(new Option(row.name, row.name));
    }
    if (selected && ![...filter.options].some(option => option.value === selected)) {
      filter.add(new Option(selected, selected));
    }
    filter.value = selected;
  } catch {
    if (version !== neighborhoodVersion) return;
  }
  updateLocationControls();
  load();
}

$('#saveLocation').onclick = async () => {
  const saved = !updateLocationControls();
  try {
    await feedRequest('/api/locations', 'PUT', { city: citySelect.value, neighborhood: $('#neighborhood').value, saved });
    await refreshSavedLocations();
    $('#cityStatus').textContent = saved ? 'Location saved to your account.' : 'Location removed.';
  } catch (error) {
    $('#cityStatus').textContent = error.message;
  }
};
$('#savedLocations').onchange = event => {
  if (event.target.value === '') return;
  const place = savedLocations[Number(event.target.value)];
  citySelect.value = addCityOption(place.city);
  changeCity(place.neighborhood);
  citySelect.focus();
};
$('#ratingForm').onsubmit = async event => {
  event.preventDefault();
  const neighborhood = $('#neighborhood').value;
  try {
    await feedRequest('/api/neighborhoods/rating', 'PUT', {
      city: citySelect.value, neighborhood, stars: Number($('#ratingStars').value),
    });
    $('#cityStatus').textContent = 'Your neighborhood rating was saved.';
    changeCity(neighborhood);
  } catch (error) {
    $('#cityStatus').textContent = error.message;
  }
};
$('#neighborhood').onchange = () => { updateLocationControls(); load(); };
$('#minRating').onchange = load;
$('#maxPrice').onchange = load;
$('#affordableOnly').onchange = load;
for (let hour = 0; hour < 24; hour++) {
  $('#watchHour').add(new Option(String(hour).padStart(2, '0') + ':00 UTC', String(hour), hour === 11, hour === 11));
}

initializeApp();
