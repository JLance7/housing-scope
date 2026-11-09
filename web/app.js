const API_ROOT=location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
const stageFetch=(path,options)=>window.homeScopeAuth.fetch(path.startsWith('/api/')?API_ROOT+path:path,options);
const accountMode = Boolean(window.HOMESCOPE_AUTH);
let account = null;
const $=s=>document.querySelector(s),fmt=n=>'$'+Math.round(n||0).toLocaleString();let listings=[],savedOnly=false;
const DEFAULT_CITY = 'New York';
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

readCities().forEach(addCityOption);
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
async function load(){const version=++loadVersion;const city=citySelect.value;$('#currentCity').textContent=city.toUpperCase();const p=new URLSearchParams({budget:$('#budget').value,property_type:$('#type').value,area:$('#area').value,q:$('#searchText').value,sort:$('#sort').value,saved_only:savedOnly,neighborhood:$('#neighborhood').value,min_rating:$('#minRating').value,affordable_only:$('#affordableOnly').checked});if($('#maxPrice').value!=='')p.set('max_price',$('#maxPrice').value);try{const route=accountMode&&!account?'/api/public/listings':'/api/listings';const r=await stageFetch(route+'?'+p);if(!r.ok)throw Error();const results=await r.json();if(version!==loadVersion)return;listings=results;render()}catch(e){if(version!==loadVersion)return;$('#listingGrid').innerHTML='<div class="error">Start the API with run.bat to load saved listings.</div>'}}
function render(){const budget=+$('#budget').value;$('#budgetValue').textContent=fmt(budget);$('#count').textContent=listings.length;$('#affordableCount').textContent=listings.filter(x=>x.monthly_cost<=budget).length;$('#avgPayment').textContent=listings.length?fmt(listings.reduce((a,x)=>a+x.monthly_cost,0)/listings.length):'—';$('#savedCount').textContent=listings.filter(x=>x.favorite).length;$('#empty').classList.toggle('hidden',listings.length>0);$('#listingGrid').innerHTML=listings.map(x=>'<article class="listing"><div class="listing-art '+(x.property_type==='Apartment'?'apartment':'')+'"><span>'+(x.source==='RentCast'?'RentCast · checked '+escapeHtml(x.updated_at):x.source==='Sample data'?'Sample listing':x.change_30d<0?'Price reduced':'Listing')+'</span>'+(accountMode&&!account?'':'<button class="heart '+(x.favorite?'saved':'')+'" data-save="'+escapeHtml(encodeURIComponent(x.id))+'">'+(x.favorite?'♥':'♡')+'</button>')+'</div><div class="listing-info"><div class="listing-top"><div><h3>'+escapeHtml(x.title)+'</h3><div class="location">'+escapeHtml(x.area)+(x.neighborhood?' · '+escapeHtml(x.neighborhood):'')+' · '+escapeHtml(x.property_type)+'</div></div><div class="price">'+fmt(x.price)+'<small>'+(x.property_type==='House'?'asking price':'per month')+'</small></div></div>'+(x.rating_count?'<p class="muted">Neighborhood rating: '+escapeHtml(x.rating)+'/5 ('+escapeHtml(x.rating_count)+')</p>':'')+'<div class="facts"><span>'+escapeHtml(x.beds)+' beds</span><span>'+escapeHtml(x.baths)+' baths</span><span>'+Number(x.sqft||0).toLocaleString()+' sq ft</span></div><div class="cost-row"><span>Est. monthly cost</span><b>'+fmt(x.monthly_cost)+(x.property_type==='Apartment'?'/mo':'')+'</b></div>'+(safeSource(x.source_url)?'<a class="source-link" href="'+safeSource(x.source_url)+'" target="_blank" rel="noopener">View source listing ↗</a>':'')+'</div></article>').join('');document.querySelectorAll('[data-save]').forEach(b=>b.onclick=async()=>{await stageFetch('/api/listings/'+b.dataset.save+'/favorite',{method:'POST'});load()});renderAreas()}
async function renderAreas(){if(accountMode&&!account){$('#areaBars').textContent='Sign in to see the area cost snapshot.';return}const version=loadVersion;const city=citySelect.value;const all=await stageFetch('/api/areas').then(r=>r.ok?r.json():[]).catch(()=>[]);if(version!==loadVersion)return;const a=all.filter(x=>sameCity(x.name,city)),m=Math.max(1,...a.map(x=>x.avg_monthly));$('#areaBars').innerHTML=a.map(x=>'<div class="area-line"><span class="name">'+escapeHtml(x.name)+'</span><div class="bar-bg"><div class="bar" style="width:'+Math.max(12,x.avg_monthly/m*100)+'%"></div></div><span class="num">'+fmt(x.avg_monthly)+'</span></div>').join('') || '<p class="muted">No listings for this city yet.</p>'}
let timer;$('#budget').oninput=()=>{clearTimeout(timer);timer=setTimeout(load,200)};$('#type').onchange=load;$('#area').onchange=()=>changeCity();$('#searchText').oninput=()=>{clearTimeout(timer);timer=setTimeout(load,200)};$('#sort').onchange=load;document.querySelector('a[href="#saved"]').onclick=e=>{e.preventDefault();if(accountMode&&!account){$('#signIn').focus();return}savedOnly=!savedOnly;load()};$('#csvFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const r=await stageFetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:await f.text()})});const x=await r.json();alert('Imported '+x.imported+' listings');load();e.target.value=''};$('#clearFilters').onclick=()=>{$('#budget').value=2400;$('#type').value='all';$('#area').value=DEFAULT_CITY;$('#searchText').value='';$('#minRating').value='0';$('#maxPrice').value='';$('#affordableOnly').checked=false;savedOnly=false;changeCity()};

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
  if (accountMode && !account) return;
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
    $('#syncFeed').hidden = !account;
    $('#marketForm').hidden = !account;
    $('#ownerPanel').hidden = !account?.owner;
    $('#csvFile').closest('label').hidden = !admin;
    $('#watchRemove').disabled = !account;
    $('#watchEmail').readOnly = true;
    $('#watchEmail').required = false;
    $('#watchEmail').value = account?.email || '';
    if (!account) {
      $('#feedStatus').textContent = 'Sign in with Google to view city schedules and save an email watch.';

    }
  }
  if (accountMode) {
    try {
      const markets = await feedRequest('/api/public/markets', 'GET');
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
    const data = await feedRequest('/api/public/neighborhoods?' + new URLSearchParams({ area: city }), 'GET');
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
