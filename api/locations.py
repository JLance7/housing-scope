"""Private saved searches and public aggregate neighborhood ratings."""
from collections import defaultdict
from hashlib import sha256

from api.storage import feed_settings, write_feed_setting


def identifier(value):
    return sha256(value.strip().casefold().encode()).hexdigest()


def normalize_place(value):
    return ' '.join(str(value or '').split())[:80]


def saved_locations(subject):
    return sorted(feed_settings(f'location:{subject}:'), key=lambda item: (item['city'], item['neighborhood']))


def save_location(subject, city, neighborhood, saved):
    key = f'location:{subject}:{identifier(city)}:{identifier(neighborhood)}'
    value = {'city': city, 'neighborhood': neighborhood}
    write_feed_setting(key, value if saved else None)


def rate_neighborhood(subject, city, neighborhood, stars):
    key = f'review:{identifier(city)}:{identifier(neighborhood)}:{subject}'
    write_feed_setting(key, {'city': city, 'neighborhood': neighborhood, 'stars': stars})


def neighborhood_ratings(city):
    prefix = 'review:' if city == 'all' else f'review:{identifier(city)}:'
    totals = defaultdict(list)
    for review in feed_settings(prefix):
        totals[(review['city'].casefold(), review['neighborhood'].casefold())].append(review['stars'])
    return {
        key: {'rating': round(sum(stars) / len(stars), 2), 'rating_count': len(stars)}
        for key, stars in totals.items()
    }

