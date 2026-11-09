"""Send a digest for newly matched listings after a scheduled import."""
from hashlib import sha256
import logging
import os

from api.storage import feed_settings, monthly_cost, read_feed_setting, write_feed_setting

log = logging.getLogger(__name__)


def watch_key(city, email):
    return sha256(f'{city.casefold()}|{email}'.encode()).hexdigest()


def matches(watch, listing):
    searchable = f"{listing['title']} {listing['address']}".casefold()
    return (watch['city'].casefold() == listing['area'].casefold()
            and watch['property_type'] in ('all', listing['property_type'])
            and watch['keyword'].casefold() in searchable
            and (watch['budget'] is None or monthly_cost(listing) <= watch['budget']))


def send_matches(listings):
    sender = os.getenv('HOMESCOPE_ALERT_FROM', '').strip()
    if not sender:
        return
    import boto3

    client = boto3.client('ses')
    notices = {row['key']: row['ids'] for row in feed_settings('notices:')}
    for watch in feed_settings('watch:'):
        if os.getenv('HOMESCOPE_AUTH_REQUIRED') == 'true':
            subject = watch.get('subject')
            if not subject or not watch.get('privileged'):
                continue
            access = read_feed_setting('alert_access:' + subject)
            if access and not access['enabled']:
                continue
        key = watch['key']
        seen = notices.get(key, [])
        new = [row for row in listings if row['id'] not in seen and matches(watch, row)]
        if not new:
            continue
        lines = [f"{row['address']} — {monthly_cost(row):,.0f} USD/mo estimated" for row in new[:10]]
        if len(new) > 10:
            lines.append(f'Plus {len(new) - 10} more. See HomeScope for the full results.')
        body = '\n'.join(lines) + '\n\nManage or unsubscribe from this watch in HomeScope.'
        try:
            client.send_email(
                Source=sender, Destination={'ToAddresses': [watch['email']]},
                Message={'Subject': {'Data': f"HomeScope matches in {watch['city']}", 'Charset': 'UTF-8'},
                         'Body': {'Text': {'Data': body, 'Charset': 'UTF-8'}}},
            )
        except Exception as exc:
            log.warning('HomeScope alert delivery failed (%s)', type(exc).__name__)
            continue
        write_feed_setting('notices:' + key, {'key': key, 'ids': (seen + [row['id'] for row in new])[-1000:]})

