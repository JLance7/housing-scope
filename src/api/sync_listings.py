"""Scheduled and manual ETL entry points for HomeScope."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from api import rentcast
from dotenv import load_dotenv


PREVIEW_CITY = 'Salt Lake City'
PREVIEW_STATE = 'UT'


def configured_markets():
    from api.storage import feed_settings

    configured = rentcast.markets(os.getenv('RENTCAST_MARKETS', 'Salt Lake City,UT'))
    markets = {city.casefold(): (city, state) for city, state in configured}
    markets[PREVIEW_CITY.casefold()] = (PREVIEW_CITY, PREVIEW_STATE)
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
            save_alert_batch(imported, rentcast.today())
        return count

    return 0


def save_alert_batch(listings, day):
    from api.storage import write_feed_setting

    fields = ('id','area','neighborhood','property_type','price','rent','hoa_monthly','taxes_yearly','insurance_yearly')
    snapshots = []
    for listing in listings[:100]:
        row = {field: listing.get(field) for field in fields}
        row.update(title=listing['title'][:180], address=listing['address'][:240])
        snapshots.append(row)
    write_feed_setting(f'alert_batch:{day.toordinal() % 2}', {'day': day.isoformat(), 'listings': snapshots})


def scheduled_tick(now):
    from api.alerts import send_matches, topic_prefix
    from api.storage import read_feed_setting, reserve_scheduled_slot

    updated = 0
    if now.hour == 11:
        if os.getenv('HOMESCOPE_AUTH_REQUIRED') == 'true':
            updated = refresh_preview()
        else:
            updated = sync_feed(scheduled=True)
    if not topic_prefix() or os.getenv('HOMESCOPE_DAILY_ENABLED', 'true') != 'true':
        return {'updated': updated}
    enabled = enabled_cities()
    if not enabled:
        return {'updated': updated}

    slot = now.strftime('%Y-%m-%dT%H')
    if not reserve_scheduled_slot('__homescope_alert_hour__', slot):
        return {'updated': updated}
    newest = {}
    for day in (now.date() - timedelta(days=1), now.date()):
        batch = read_feed_setting(f'alert_batch:{day.toordinal() % 2}')
        if batch and batch['day'] == day.isoformat():
            newest.update((row['id'], row) for row in batch['listings'])
    candidates = [row for row in newest.values() if row['area'].casefold() in enabled]
    if candidates:
        send_matches(candidates, hour=now.hour)
    return {'updated': updated}


def refresh_preview():
    from api.storage import normalize, reserve_rentcast_day, save_row

    key = os.getenv('RENTCAST_API_KEY', '').strip()
    day = rentcast.today()
    if not key or not reserve_rentcast_day(day.isoformat()):
        return 0
    imported = []
    for raw in rentcast.fetch_listings(key, PREVIEW_CITY, PREVIEW_STATE, 'rental/long-term'):
        listing = rentcast.listing(raw, PREVIEW_CITY, PREVIEW_STATE, 'rental/long-term', day)
        if listing is not None:
            row = normalize(listing)
            row['updated_at'] = listing['updated_at']
            save_row(row, keep_favorite=True)
            imported.append(row)
    if imported:
        save_alert_batch(imported, day)
    return len(imported)


def lambda_handler(event, context):
    from api.storage import TABLE, init_db

    if not TABLE:
        init_db()
    rule = os.getenv('HOMESCOPE_SCHEDULE_RULE_ARN')
    if (event.get('source') != 'aws.events' or event.get('detail-type') != 'Scheduled Event'
            or (rule and rule not in event.get('resources', []))):
        raise ValueError('Unknown ETL trigger.')
    now = datetime.fromisoformat(event['time'].replace('Z', '+00:00')).astimezone(timezone.utc)
    return scheduled_tick(now)


def main():
    load_dotenv(Path(__file__).resolve().parents[2] / '.env')

    import argparse
    from api.storage import TABLE, init_db

    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--scheduled', action='store_true')
    mode.add_argument('--city', default='')
    options = parser.parse_args()
    if not TABLE:
        init_db()
    result = scheduled_tick(datetime.now(timezone.utc)) if options.scheduled else {'updated': sync_feed(city=options.city)}
    print(f"Updated {result['updated']} listings.")


if __name__ == '__main__':
    main()

