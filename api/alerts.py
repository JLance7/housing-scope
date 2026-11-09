"""Manage private SNS email watches and publish scheduled match digests."""
from hashlib import sha256
import logging
import os

from api.storage import feed_settings, monthly_cost, read_feed_setting, write_feed_setting

log = logging.getLogger(__name__)


def watch_key(city, email):
    return sha256(f'{city.casefold()}|{email}'.encode()).hexdigest()


def topic_prefix():
    return os.getenv('HOMESCOPE_SNS_TOPIC_PREFIX', '').strip()


def sns_client():
    import boto3

    return boto3.client('sns')


def subscribe_watch(key, email):
    suffix = sha256(f'{key}|{email}'.encode()).hexdigest()
    client = sns_client()
    topic = client.create_topic(Name=topic_prefix() + suffix)['TopicArn']
    attributes = client.get_topic_attributes(TopicArn=topic)['Attributes']
    confirmed = int(attributes.get('SubscriptionsConfirmed', '0')) > 0
    if not confirmed and not int(attributes.get('SubscriptionsPending', '0')):
        client.subscribe(TopicArn=topic, Protocol='email', Endpoint=email)
    return topic, not confirmed


def delete_watch_topic(topic):
    if topic:
        sns_client().delete_topic(TopicArn=topic)


def matches(watch, listing):
    searchable = f"{listing['title']} {listing['address']}".casefold()
    return (watch['city'].casefold() == listing['area'].casefold()
            and watch['property_type'] in ('all', listing['property_type'])
            and (not watch.get('neighborhood') or watch['neighborhood'].casefold() == (listing.get('neighborhood') or '').casefold())
            and watch['keyword'].casefold() in searchable
            and (watch['budget'] is None or monthly_cost(listing) <= watch['budget']))


def send_matches(listings, hour=11):
    if not topic_prefix():
        return

    client = sns_client()
    notices = {row['key']: row['ids'] for row in feed_settings('notices:')}
    for watch in feed_settings('watch:'):
        if watch.get('alert_hour', 11) != hour:
            continue
        topic = watch.get('topic')
        if not topic:
            continue
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
            attributes = client.get_topic_attributes(TopicArn=topic)['Attributes']
            if not int(attributes.get('SubscriptionsConfirmed', '0')):
                continue
            client.publish(TopicArn=topic, Subject=f"HomeScope listing matches",
                           Message=f"New matches in {watch['city']}\n\n{body}")
        except Exception as exc:
            log.warning('HomeScope alert delivery failed (%s)', type(exc).__name__)
            continue
        write_feed_setting('notices:' + key, {'key': key, 'ids': (seen + [row['id'] for row in new])[-1000:]})

