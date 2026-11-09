"""Scheduled and manual ETL entry points for HomeScope."""
import json
import os
import urllib.request
from pathlib import Path

from api import rentcast
from dotenv import load_dotenv


def configured_markets():
    from api.storage import feed_settings

    configured = rentcast.markets(os.getenv('RENTCAST_MARKETS', 'New York,NY'))
    markets = {city.casefold(): (city, state) for city, state in configured}
    for market in sorted(feed_settings('market:'), key=lambda row: row['city'].casefold()):
        city, state = market['city'], market['state']
        markets.setdefault(city.casefold(), (city, state))
    return list(markets.values())


def enabled_cities():
    from api.storage import feed_settings

    return {row['city'].casefold() for row in feed_settings('schedule:')}


def sync_feed(*, city='', scheduled=False):
    from api.storage import normalize, reserve_manual_rentcast_day, reserve_rentcast_day, save_row

    key = os.getenv('RENTCAST_API_KEY', '').strip()
    if key:
        selected = configured_markets()
        if scheduled:
            enabled = enabled_cities()
            selected = [market for market in selected if market[0].casefold() in enabled]
        elif city:
            selected = [market for market in selected if market[0].casefold() == city.casefold()]
        imported = []

        def save_listing(item):
            row = normalize(item)
            row['updated_at'] = item['updated_at']
            save_row(row, keep_favorite=True)
            imported.append(row)

        reserve = reserve_rentcast_day if scheduled else reserve_manual_rentcast_day
        count = rentcast.sync(key, selected, reserve, save_listing)
        if scheduled and imported:
            from api.alerts import send_matches

            send_matches(imported)
        return count

    url = os.getenv('LISTING_FEED_URL', '').strip()
    if not url:
        return 0
    request = urllib.request.Request(url, headers={'Accept': 'application/json'})
    token = os.getenv('LISTING_FEED_TOKEN', '')
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.load(response)
    rows = data.get('listings', data) if isinstance(data, dict) else data
    for item in rows:
        save_row(normalize(item))
    return len(rows)


def lambda_handler(event, context):
    from api.storage import TABLE, init_db

    if not TABLE:
        init_db()
    if event.get('mode') == 'manual':
        city = event.get('city', '')
        if not isinstance(city, str) or len(city) > 80:
            raise ValueError('Invalid manual import city.')
        return {'updated': sync_feed(city=city)}

    rule = os.getenv('HOMESCOPE_SCHEDULE_RULE_ARN')
    if (event.get('source') != 'aws.events' or event.get('detail-type') != 'Scheduled Event'
            or (rule and rule not in event.get('resources', []))):
        raise ValueError('Unknown ETL trigger.')
    return {'updated': sync_feed(scheduled=True)}


def main():
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')

    import argparse
    from api.storage import TABLE, init_db

    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--scheduled', action='store_true')
    mode.add_argument('--city', default='')
    options = parser.parse_args()
    if not TABLE:
        init_db()
    print(f"Updated {sync_feed(city=options.city, scheduled=options.scheduled)} listings.")


if __name__ == '__main__':
    main()

