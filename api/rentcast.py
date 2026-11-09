import json
from datetime import datetime, timezone
from hashlib import sha256
from math import isfinite
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE = 'RentCast'
MARKER = '__homescope_rentcast_daily__'
ENDPOINTS = ('sale', 'rental/long-term')


def markets(value):
    result = []
    for entry in value.split(';'):
        city, sep, state = entry.strip().rpartition(',')
        city, state = city.strip(), state.strip().upper()
        if not sep or not city or len(state) != 2 or not state.isascii() or not state.isalpha():
            raise ValueError('Use RENTCAST_MARKETS in City,ST;Other City,ST format.')
        market = (city, state)
        if market not in result:
            result.append(market)
    return result


def today():
    return datetime.now(timezone.utc).date()


def fetch_listings(key, city, state, endpoint):
    query = urlencode({'city': city, 'state': state, 'status': 'Active', 'limit': 100})
    request = Request(f'https://api.rentcast.io/v1/listings/{endpoint}?{query}',
                      headers={'Accept': 'application/json', 'X-Api-Key': key})
    try:
        with urlopen(request, timeout=15) as response:
            rows = json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f'RentCast returned HTTP {exc.code}. Check the API dashboard.') from None
    except (URLError, TimeoutError, ValueError):
        raise RuntimeError('Could not read the RentCast listing response.') from None
    if not isinstance(rows, list):
        raise RuntimeError('RentCast returned an unexpected listing format.')
    return rows


def listing(raw, city, state, endpoint, day):
    if not isinstance(raw, dict) or raw.get('status') != 'Active' or not raw.get('id'):
        return None
    address = raw.get('formattedAddress') or raw.get('addressLine1')
    if not address or str(raw.get('propertyType', '')).lower() == 'land':
        return None
    try:
        price = float(raw.get('price') or 0)
        if not isfinite(price) or price <= 0:
            return None
        hoa = raw.get('hoa') or {}
        numbers = [float(raw.get(field) or 0) for field in ('bedrooms', 'bathrooms', 'squareFootage')]
        numbers.append(float(hoa.get('fee') or 0) if isinstance(hoa, dict) else 0)
        if not all(isfinite(value) and value >= 0 for value in numbers):
            return None
    except (TypeError, ValueError, OverflowError):
        return None
    beds, baths, sqft, hoa = numbers
    rental = endpoint != 'sale'
    identifier = sha256(f"{endpoint}|{state}|{raw['id']}".encode()).hexdigest()
    return {'id': 'rentcast-' + identifier, 'title': raw.get('addressLine1') or address,
            'area': city, 'address': address, 'property_type': 'Apartment' if rental else 'House',
            'price': price, 'rent': price if rental else None, 'beds': beds, 'baths': baths,
            'sqft': int(sqft), 'hoa_monthly': 0 if rental else hoa, 'source': SOURCE,
            'updated_at': day.isoformat()}


def sync(key, selected_markets, reserve, save):
    day = today()
    queue = [(city, state, endpoint) for city, state in selected_markets
             for endpoint in ENDPOINTS]
    if not queue:
        return 0
    city, state, endpoint = queue[day.toordinal() % len(queue)]
    if not reserve(day.isoformat()):
        return 0
    count = 0
    for raw in fetch_listings(key, city, state, endpoint):
        item = listing(raw, city, state, endpoint, day)
        if item is not None:
            save(item)
            count += 1
    return count

