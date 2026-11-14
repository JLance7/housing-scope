import json
import os
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from api import rentcast

ROOT = Path(__file__).resolve().parent.parent
DB = Path(os.getenv('HOMESCOPE_DB', ROOT.parent / 'data' / 'homescope.db'))
TABLE = os.getenv('DYNAMODB_TABLE', '').strip()


def db():
 DB.parent.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;return c
def init_db():
 with closing(db()) as c:
  c.execute("CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,title TEXT NOT NULL,area TEXT NOT NULL,property_type TEXT NOT NULL,address TEXT,price REAL NOT NULL,rent REAL,beds REAL,baths REAL,sqft INTEGER,hoa_monthly REAL DEFAULT 0,taxes_yearly REAL DEFAULT 0,insurance_yearly REAL DEFAULT 0,change_30d REAL DEFAULT 0,source TEXT,source_url TEXT,favorite INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,neighborhood TEXT)");c.commit()
  if 'neighborhood' not in {row['name'] for row in c.execute('PRAGMA table_info(listings)')}:
   try:
    c.execute('ALTER TABLE listings ADD COLUMN neighborhood TEXT')
    c.commit()
   except sqlite3.OperationalError as exc:
    if 'duplicate column name' not in str(exc):raise
def dynamo_table():
 if not TABLE:return None
 import boto3
 return boto3.resource('dynamodb').Table(TABLE)
def all_rows():
 t=dynamo_table()
 if t:
  items=[];response=t.scan();items.extend(response.get('Items',[]))
  while response.get('LastEvaluatedKey'):
   response=t.scan(ExclusiveStartKey=response['LastEvaluatedKey']);items.extend(response.get('Items',[]))
  return [item for item in items if not item['id'].startswith('__homescope_')]
 with closing(db()) as c:return [dict(r) for r in c.execute('SELECT * FROM listings').fetchall()]
def save_row(item, *, keep_favorite=False):
 t=dynamo_table()
 if t:
  values={k:(Decimal(str(v)) if isinstance(v,float) else v) for k,v in item.items() if v is not None}
  if keep_favorite:
   fields=[field for field in values if field not in ('id','favorite')]
   names={f'#f{i}':field for i,field in enumerate(fields)}
   expression=', '.join(f'#f{i} = :v{i}' for i in range(len(fields)))
   attrs={f':v{i}':values[field] for i,field in enumerate(fields)}
   t.update_item(Key={'id':item['id']},UpdateExpression='SET '+expression,
                 ExpressionAttributeNames=names,ExpressionAttributeValues=attrs)
  else:
   t.put_item(Item=values)
  return
 fields=['id','title','area','property_type','address','price','rent','beds','baths','sqft','hoa_monthly','taxes_yearly','insurance_yearly','change_30d','source','source_url','favorite','neighborhood']
 if 'updated_at' in item:fields.append('updated_at')
 values=[item.get(k) for k in fields]
 updates=[k for k in fields if k!='id' and (k!='favorite' or not keep_favorite)]
 with closing(db()) as c:
  c.execute(f"INSERT INTO listings ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)}) ON CONFLICT(id) DO UPDATE SET "+','.join(f'{k}=excluded.{k}' for k in updates),values);c.commit()

def normalize(d):
 typ=str(d.get('property_type') or d.get('type') or 'House').title();typ='Apartment' if typ.lower() in ('apartment','rental','rent') else 'House';identity=str(d.get('id') or d.get('listing_id') or d.get('url') or f"{d.get('title','home')}|{d.get('address','')}|{d.get('city') or d.get('area','')}")
 return {'id':identity,'title':str(d.get('title') or 'Listing'),'area':str(d.get('city') or d.get('area') or 'Unspecified'),'property_type':typ,'address':str(d.get('address') or ''),'neighborhood':' '.join(str(d.get('neighborhood') or '').split())[:80],'price':float(d.get('price') or d.get('sale_price') or d.get('rent') or 0),'rent':float(d.get('rent') or 0) if typ=='Apartment' else None,'beds':float(d.get('beds') or d.get('bedrooms') or 0),'baths':float(d.get('baths') or d.get('bathrooms') or 0),'sqft':int(float(d.get('sqft') or 0)),'hoa_monthly':float(d.get('hoa_monthly') or d.get('hoa') or 0),'taxes_yearly':float(d.get('taxes_yearly') or 0),'insurance_yearly':float(d.get('insurance_yearly') or 0),'change_30d':float(d.get('change_30d') or 0),'source':str(d.get('source') or 'Imported feed'),'source_url':str(d.get('source_url') or d.get('url') or ''),'favorite':int(bool(d.get('favorite',False)))}

def reserve_rentcast_day(day):
 return reserve_scheduled_slot(rentcast.MARKER,day)

def reserve_scheduled_slot(marker,slot):
 t=dynamo_table()
 if t:
  try:
   t.put_item(Item={'id':marker,'sync_day':slot},
              ConditionExpression='attribute_not_exists(id) OR sync_day < :day',
              ExpressionAttributeValues={':day':slot})
  except t.meta.client.exceptions.ConditionalCheckFailedException:
   return False
  return True
 with closing(db()) as c:
  c.execute('CREATE TABLE IF NOT EXISTS sync_state (provider TEXT PRIMARY KEY, day TEXT NOT NULL)')
  result=c.execute(
   'INSERT INTO sync_state VALUES (?, ?) ON CONFLICT(provider) DO UPDATE SET day=excluded.day '
   'WHERE sync_state.day < excluded.day', (rentcast.SOURCE if marker==rentcast.MARKER else marker,slot))
  c.commit()
  return result.rowcount==1



def feed_settings(prefix):
    table = dynamo_table()
    key_prefix = '__homescope_' + prefix
    if table:
        from boto3.dynamodb.conditions import Attr
        params = {'FilterExpression': Attr('id').begins_with(key_prefix), 'ConsistentRead': True}
        result = []
        while True:
            page = table.scan(**params)
            result.extend(json.loads(row['payload']) for row in page.get('Items', []))
            if not page.get('LastEvaluatedKey'):
                return result
            params['ExclusiveStartKey'] = page['LastEvaluatedKey']
    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        return [json.loads(row['payload']) for row in conn.execute(
            'SELECT payload FROM feed_settings WHERE substr(id, 1, ?) = ?', (len(key_prefix), key_prefix)
        )]


def read_feed_setting(key):
    key = '__homescope_' + key
    table = dynamo_table()
    if table:
        row = table.get_item(Key={'id': key}, ConsistentRead=True).get('Item')
        if row and 'listing_ids' in row:
            return list(row['listing_ids'])
        return json.loads(row['payload']) if row and 'payload' in row else None
    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        row = conn.execute('SELECT payload FROM feed_settings WHERE id = ?', (key,)).fetchone()
        return json.loads(row['payload']) if row else None


def write_feed_setting(key, value):
    key = '__homescope_' + key
    table = dynamo_table()
    if table:
        if value is None:
            table.delete_item(Key={'id': key})
        else:
            table.put_item(Item={'id': key, 'payload': json.dumps(value)})
        return
    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        if value is None:
            conn.execute('DELETE FROM feed_settings WHERE id = ?', (key,))
        else:
            conn.execute('INSERT OR REPLACE INTO feed_settings VALUES (?, ?)', (key, json.dumps(value)))
        conn.commit()


def change_feed_setting(key, update):
    """Apply an update against the current value, retrying conflicting writes."""
    item_id = '__homescope_' + key
    table = dynamo_table()
    if table:
        for _ in range(8):
            row = table.get_item(Key={'id': item_id}, ConsistentRead=True).get('Item')
            previous = row['payload'] if row else None
            value, result = update(json.loads(previous) if previous is not None else None)
            if value is None:
                return result
            condition = {'ConditionExpression': 'attribute_not_exists(id)'}
            if row:
                condition = {'ConditionExpression': 'payload = :previous',
                             'ExpressionAttributeValues': {':previous': previous}}
            try:
                table.put_item(Item={'id': item_id, 'payload': json.dumps(value)}, **condition)
                return result
            except table.meta.client.exceptions.ConditionalCheckFailedException:
                continue
        raise RuntimeError('Concurrent usage update')

    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT payload FROM feed_settings WHERE id = ?', (item_id,)).fetchone()
        value, result = update(json.loads(row['payload']) if row else None)
        if value is not None:
            conn.execute('INSERT OR REPLACE INTO feed_settings VALUES (?, ?)', (item_id, json.dumps(value)))
        conn.commit()
        return result

def monthly_cost(x):
 if x.get('property_type')=='Apartment':return round(float(x.get('rent') or x.get('price') or 0)+float(x.get('hoa_monthly') or 0),2)
 principal=float(x.get('price') or 0)*.9;rate=float(os.getenv('MORTGAGE_RATE','0.0675'))/12;months=360
 payment=principal/months if rate==0 else principal*rate/(1-(1+rate)**(-months))
 return round(payment+float(x.get('taxes_yearly') or 0)/12+float(x.get('insurance_yearly') or 0)/12+float(x.get('hoa_monthly') or 0),2)

def set_account_favorite(subject, listing_id, favorite):
    key = '__homescope_favorites:' + subject
    table = dynamo_table()
    if table:
        action = 'ADD' if favorite else 'DELETE'
        table.update_item(Key={'id': key}, UpdateExpression=f'{action} listing_ids :listing',
                          ExpressionAttributeValues={':listing': {listing_id}})
        return
    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT payload FROM feed_settings WHERE id = ?', (key,)).fetchone()
        saved = set(json.loads(row['payload'])) if row else set()
        (saved.add if favorite else saved.discard)(listing_id)
        conn.execute('INSERT OR REPLACE INTO feed_settings VALUES (?, ?)', (key, json.dumps(sorted(saved))))
        conn.commit()


def reserve_rentcast_request(day):
    """Cover a full billing cycle even when it crosses a daylight-saving change."""
    return reserve_rentcast_days('__homescope_rentcast_requests__', day, 50, window_days=33)


def reserve_manual_rentcast_day(day):
    """One manual call per UTC date and at most 15 across any 32 UTC dates."""
    return reserve_rentcast_days('__homescope_rentcast_manual__', day, 15, once_per_day=True)


def reserve_rentcast_days(key, day, limit, *, window_days=32, once_per_day=False):
    cutoff = (date.fromisoformat(day) - timedelta(days=window_days - 1)).isoformat()

    def next_days(days):
        recent = [value for value in days if value >= cutoff]
        if len(recent) >= limit or (once_per_day and recent and max(recent) >= day):
            return None
        return recent + [day]

    table = dynamo_table()
    if table:
        for _ in range(3):
            row = table.get_item(Key={'id': key}, ConsistentRead=True).get('Item')
            previous = row['days'] if row else []
            days = next_days(previous)
            if days is None:
                return False
            condition = {'ConditionExpression': 'attribute_not_exists(id)'}
            if row:
                condition = {
                    'ConditionExpression': '#days = :previous',
                    'ExpressionAttributeNames': {'#days': 'days'},
                    'ExpressionAttributeValues': {':previous': previous},
                }
            try:
                table.put_item(Item={'id': key, 'days': days}, **condition)
                return True
            except table.meta.client.exceptions.ConditionalCheckFailedException:
                continue
        return False

    with closing(db()) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS feed_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT payload FROM feed_settings WHERE id = ?', (key,)).fetchone()
        days = next_days(json.loads(row['payload']) if row else [])
        if days is None:
            return False
        conn.execute('INSERT OR REPLACE INTO feed_settings VALUES (?, ?)', (key, json.dumps(days)))
        conn.commit()
        return True
