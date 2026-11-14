"""Private RentCast credentials, usage guard, and listing snapshots."""

import os
from datetime import date, timedelta
from hashlib import sha256
from hmac import compare_digest, digest

from api import rentcast, storage

FREE_LIMIT = 50
OVERAGE_CENTS = 20
WINDOW_DAYS = 33


def scope(subject):
    return sha256(subject.encode()).hexdigest()


def private_prefix(subject):
    return 'rentcast_private:' + scope(subject) + ':'


def parameter_name(subject):
    return os.environ['HOMESCOPE_RENTCAST_KEY_PREFIX'] + '/' + scope(subject)


def parameters():
    import boto3
    return boto3.client('ssm')


def read_key(subject, *, decrypt):
    if not os.getenv('HOMESCOPE_RENTCAST_KEY_PREFIX'):
        return None
    client = parameters()
    try:
        result = client.get_parameter(Name=parameter_name(subject), WithDecryption=decrypt)
    except client.exceptions.ParameterNotFound:
        return None
    return result['Parameter']['Value'] if decrypt else True


def connect(subject, key, free_left):
    # Lower the allowance before replacing a key. Replacement never resets the ledger.
    def reduce_allowance(existing):
        usage = existing or {'sequence': 0, 'days': {}, 'holds': {}, 'paid_successes': 0}
        day = rentcast.today().isoformat()
        left = remaining(usage, day)
        if free_left < left:
            usage['holds'][day] = usage['holds'].get(day, 0) + left - free_left
        return usage, None

    storage.change_feed_setting(usage_key(subject), reduce_allowance)
    parameters().put_parameter(Name=parameter_name(subject), Value=key, Type='SecureString',
                               Tier='Standard', Overwrite=True)


def disconnect(subject):
    client = parameters()
    try:
        client.delete_parameter(Name=parameter_name(subject))
    except client.exceptions.ParameterNotFound:
        pass


def usage_key(subject):
    return 'rentcast_usage:' + scope(subject)


def cutoff(day):
    return (date.fromisoformat(day) - timedelta(days=WINDOW_DAYS - 1)).isoformat()


def recent(entries, day):
    first = cutoff(day)
    return {date: count for date, count in entries.items() if date >= first}


def remaining(usage, day):
    reserved = sum(recent(usage.get('days', {}), day).values())
    untracked = sum(recent(usage.get('holds', {}), day).values())
    return max(0, FREE_LIMIT - reserved - untracked)


def dashboard(subject):
    usage = storage.read_feed_setting(usage_key(subject)) or {}
    day = rentcast.today().isoformat()
    paid = usage.get('paid_successes', 0)
    return {
        'connected': bool(read_key(subject, decrypt=False)),
        'free_remaining': remaining(usage, day),
        'recent_attempts': sum(recent(usage.get('days', {}), day).values()),
        'estimated_overage_cents': paid * OVERAGE_CENTS,
        'overage_cents_per_request': OVERAGE_CENTS,
    }


def reserve(subject, day, confirmed_request, sign):
    def update(existing):
        usage = existing or {'sequence': 0, 'days': {}, 'holds': {}, 'paid_successes': 0}
        sequence = usage['sequence'] + 1
        paid = remaining(usage, day) == 0
        token = sign(sequence)
        if (paid or confirmed_request is not None) and not compare_digest(confirmed_request or '', token):
            return None, {'confirmation': token}
        usage['days'] = recent(usage['days'], day)
        usage['holds'] = recent(usage['holds'], day)
        usage['days'][day] = usage['days'].get(day, 0) + 1
        usage['sequence'] = sequence
        return usage, {'paid': paid}

    return storage.change_feed_setting(usage_key(subject), update)


def record_overage(subject):
    def update(usage):
        usage['paid_successes'] += 1
        return usage, None

    storage.change_feed_setting(usage_key(subject), update)


def private_rows(subject):
    batches = storage.feed_settings(private_prefix(subject))
    return [row for batch in batches for row in batch]


def refresh(subject, key, city, state, endpoint, confirmed_request):
    decision = {}
    day = rentcast.today()
    identity = sha256(f'{city.casefold()}|{state}|{endpoint}'.encode()).hexdigest()

    def sign(sequence):
        message = f'{scope(subject)}:{day.isoformat()}:{identity}:{sequence}'
        return digest(key.encode(), message.encode(), 'sha256').hex()

    def reserve_request(day_string):
        decision.update(reserve(subject, day_string, confirmed_request, sign))
        return 'paid' in decision

    def mark_success():
        if decision['paid']:
            record_overage(subject)

    raw = rentcast.fetch_listings(key, city, state, endpoint,
                                 reserve=reserve_request, mark_success=mark_success)
    if 'confirmation' in decision:
        return decision

    rows = []
    for item in raw:
        listing = rentcast.listing(item, city, state, endpoint, day)
        if listing is None:
            continue
        row = storage.normalize(listing)
        # A bounded snapshot fits within the DynamoDB item limit.
        row.update(id='private-' + scope(subject) + '-' + row['id'], updated_at=day.isoformat(),
                   title=row['title'][:180], address=row['address'][:240])
        rows.append(row)
    storage.write_feed_setting(private_prefix(subject) + identity, rows)
    return {'updated': len(rows)}
