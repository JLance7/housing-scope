import csv, io, json, os, re, time
from datetime import timedelta
from logging import getLogger
from api import auth, locations, rentcast, rentcast_account
from hashlib import sha256
from typing import Literal, Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr, StrictInt
from api.storage import ROOT, TABLE, all_rows, init_db, monthly_cost, normalize, read_feed_setting, save_row, write_feed_setting
from api.sync_listings import PREVIEW_CITY, PREVIEW_STATE, configured_markets, sync_feed
from api.alerts import delete_watch_topic, subscribe_watch, topic_prefix, watch_key

WEB = ROOT / 'web'
logger = getLogger(__name__)

app=FastAPI(title='HomeScope API',version='1.0.0')

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
 if request.url.path=='/api/rentcast/account':
  return JSONResponse(status_code=422,content={'detail':'Enter a key and a free request balance from 0 to 50.'})
 return await request_validation_exception_handler(request,exc)


@app.on_event('startup')
def startup():
 if not TABLE:init_db()
 rows = all_rows()
 existing_ids={row['id'] for row in rows}
 for item in json.loads((ROOT/'seed_listings.json').read_text(encoding='utf-8')):
  if item['area']==PREVIEW_CITY and item['id'] not in existing_ids:
   save_row(normalize(item),keep_favorite=True)
 seeded = {'nyc-01':'Astoria','nyc-02':'Sunset Park','nyc-03':'Pelham Bay'}
 for row in rows:
  if row['id'] in seeded and row.get('source')=='Sample data' and not row.get('neighborhood'):
   row['neighborhood']=seeded[row['id']]
   save_row(row,keep_favorite=True)
class ImportBody(BaseModel):csv:str
class ListingBody(BaseModel):title:str;area:str;neighborhood:str='';property_type:str='House';price:float=Field(ge=0);rent:Optional[float]=None;beds:float=0;baths:float=0;sqft:int=0;hoa_monthly:float=0;taxes_yearly:float=0;insurance_yearly:float=0;source:str='Manual entry';source_url:str=''
def visible_rows(saved_ids=None, claims=None):
 rows=all_rows()
 if claims:
  private=rentcast_account.private_rows(claims['sub'])
  private_ids={row['id'].rsplit('-rentcast-',1)[-1] for row in private}
  rows=[row for row in rows if row['id'].removeprefix('rentcast-') not in private_ids or
        (saved_ids is not None and row['id'] in saved_ids)]
  rows.extend(private)
 cutoff=(rentcast.today()-timedelta(days=7)).isoformat()
 live_cities={
  x['area'].lower() for x in rows
  if x.get('source')==rentcast.SOURCE and str(x.get('updated_at') or '')>=cutoff
 }
 return [
  x for x in rows
  if (saved_ids is not None and x['id'] in saved_ids) or (
   (x.get('source')!=rentcast.SOURCE or str(x.get('updated_at') or '')>=cutoff)
   and (x.get('source')!='Sample data' or x['area'].lower() not in live_cities)
  )
 ]

def account_favorites(claims):
 key='favorites:'+claims['sub']
 return set(read_feed_setting(key) or [])

@app.get('/api/account')
def account(request:Request):
 claims=auth.identity(request)
 if claims is None:return {'auth_required':False,'admin':True}
 return {'auth_required':True,'admin':can_manage_sync(claims),'owner':auth.is_owner(claims),'email':auth.verified_email(request,claims)}

def public(x):
 x=dict(x);x['monthly_cost']=monthly_cost(x);x['favorite']=bool(x.get('favorite',False));return x
@app.get('/api/health')
def health():return {'status':'ok','storage':'dynamodb' if TABLE else 'sqlite'}
def browse_listings(claims,budget,property_type,area,q,sort,affordable_only,saved_only,neighborhood,min_rating,max_price,guest=False):
 saved_ids=account_favorites(claims) if claims else (
  {x['id'] for x in all_rows() if x.get('favorite')} if saved_only else None
 )
 ratings=locations.neighborhood_ratings(area)
 arr=[]
 for row in visible_rows(saved_ids if saved_only else None, claims):
  if area!='all' and row['area'].casefold()!=area.casefold():continue
  name=row.get('neighborhood') or ''
  if neighborhood and name.casefold()!=neighborhood.casefold():continue
  if property_type!='all' and row['property_type'].lower()!=property_type.lower():continue
  if q and q.casefold() not in ' '.join((row['title'],row['area'],name,row.get('address') or '')).casefold():continue
  x=public(row)
  if claims:x['favorite']=x['id'] in saved_ids
  if saved_only and not x.get('favorite'):continue
  if affordable_only and x['monthly_cost']>budget:continue
  if max_price is not None and x['price']>max_price:continue
  rating=ratings.get((row['area'].casefold(),name.casefold()),{'rating':None,'rating_count':0})
  if min_rating and (rating['rating'] or 0)<min_rating:continue
  x.update(rating,neighborhood=name)
  if guest:
   fields=('id','title','area','neighborhood','property_type','address','price','monthly_cost','beds','baths','sqft','change_30d','source','source_url','updated_at','rating','rating_count')
   x={field:x.get(field) for field in fields}
  arr.append(x)
 key={
  'price':lambda x:x['price'],
  'change':lambda x:x.get('change_30d') or 0,
  'rating':lambda x:(-(x['rating'] or 0),-x['rating_count'],x['monthly_cost']),
 }.get(sort,lambda x:x['monthly_cost'])
 arr.sort(key=key)
 return arr

@app.get('/api/listings')
def listings(request:Request,budget:float=Query(4200,ge=0),property_type:str='all',area:str='all',q:str='',sort:str='cost',affordable_only:bool=False,saved_only:bool=False,neighborhood:str='',min_rating:float=Query(0,ge=0,le=5),max_price:Optional[float]=Query(None,ge=0)):
 claims=auth.identity(request)
 return browse_listings(claims,budget,property_type,area,q,sort,affordable_only,saved_only,neighborhood,min_rating,max_price)

@app.get('/api/public/listings')
def public_listings(budget:float=Query(4200,ge=0),property_type:str='all',area:str='all',q:str='',sort:str='cost',affordable_only:bool=False,neighborhood:str='',min_rating:float=Query(0,ge=0,le=5),max_price:Optional[float]=Query(None,ge=0)):
 return browse_listings(None,budget,property_type,PREVIEW_CITY,q,sort,affordable_only,False,neighborhood,min_rating,max_price,guest=True)

@app.get('/api/public/markets')
def public_markets():
 return [{'city':PREVIEW_CITY,'state':PREVIEW_STATE}]

@app.get('/api/public/neighborhoods')
def public_neighborhoods():
 return neighborhood_summary(PREVIEW_CITY)

@app.get('/api/neighborhoods')
def neighborhoods(request:Request,area:str=Query(min_length=1,max_length=80)):
 return neighborhood_summary(area, auth.identity(request))

def neighborhood_summary(area, claims=None):
 ratings=locations.neighborhood_ratings(area)
 names={row['neighborhood'] for row in visible_rows(claims=claims)
        if row['area'].casefold()==area.casefold() and row.get('neighborhood')}
 return [dict(name=name,**ratings.get((area.casefold(),name.casefold()),{'rating':None,'rating_count':0}))
         for name in sorted(names,key=str.casefold)]

class SavedLocationBody(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 neighborhood:str=Field(default='',max_length=80)
 saved:bool

class NeighborhoodRating(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 neighborhood:str=Field(min_length=1,max_length=80)
 stars:int=Field(ge=1,le=5)

def require_account(request):
 claims=auth.identity(request)
 if claims is None:raise HTTPException(401,'Sign in to use account features')
 return claims

@app.get('/api/locations')
def get_saved_locations(request:Request):
 return locations.saved_locations(require_account(request)['sub'])

@app.put('/api/locations')
def put_saved_location(body:SavedLocationBody,request:Request):
 subject=require_account(request)['sub']
 city=locations.normalize_place(body.city)
 neighborhood=locations.normalize_place(body.neighborhood)
 if not city or city.casefold()=='all':raise HTTPException(422,'Select a city')
 locations.save_location(subject,city,neighborhood,body.saved)
 return {'saved':body.saved}

@app.put('/api/neighborhoods/rating')
def put_neighborhood_rating(body:NeighborhoodRating,request:Request):
 claims=require_account(request)
 subject=claims['sub']
 city=locations.normalize_place(body.city)
 neighborhood=locations.normalize_place(body.neighborhood)
 match=next((row for row in visible_rows(claims=claims) if row['area'].casefold()==city.casefold()
             and (row.get('neighborhood') or '').casefold()==neighborhood.casefold()),None)
 if not neighborhood or not match:raise HTTPException(404,'Neighborhood not found in this city')
 locations.rate_neighborhood(subject,match['area'],match['neighborhood'],body.stars)
 return {'stars':body.stars}

@app.get('/api/areas')
def areas(request:Request):
 claims=auth.identity(request)
 groups={}
 for x in map(public,visible_rows(claims=claims)):groups.setdefault(x['area'],[]).append(x['monthly_cost'])
 return [{'name':k,'avg_monthly':round(sum(v)/len(v)),'count':len(v)} for k,v in sorted(groups.items())]
@app.post('/api/listings/{listing_id}/favorite')
def favorite(listing_id:str,request:Request):
 claims=auth.identity(request)
 rows = rentcast_account.private_rows(claims['sub']) if claims and listing_id.startswith('private-') else all_rows()
 item=next((x for x in rows if str(x['id'])==listing_id),None)
 if not item:raise HTTPException(404,'Listing not found')
 if claims:
  from api.storage import set_account_favorite
  favorited=item['id'] not in account_favorites(claims)
  set_account_favorite(claims['sub'],item['id'],favorited)
  return {'id':listing_id,'favorite':favorited}
 item['favorite']=not bool(item.get('favorite'));save_row(item);return {'id':listing_id,'favorite':bool(item['favorite'])}
@app.post('/api/listings')
def create_listing(body:ListingBody,request:Request):
 require_admin(request)
 n=normalize(body.model_dump());n['id']=str(int(time.time()*1000));save_row(n);return public(n)
@app.post('/api/import')
def import_csv(body:ImportBody,request:Request):
 require_admin(request)
 count=0
 for row in csv.DictReader(io.StringIO(body.csv)):
  if row.get('title') or row.get('address'):save_row(normalize(row));count+=1
 return {'imported':count}
class MarketBody(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 state:str=Field(min_length=2,max_length=2)

class SyncAdminBody(BaseModel):
 email:str=Field(min_length=3,max_length=254)
 enabled:bool

@app.get('/api/feed/markets')
def list_markets(request:Request):
 auth.identity(request)
 return [{'city':city,'state':state} for city,state in configured_markets()]

@app.put('/api/feed/markets')
def add_market(body:MarketBody,request:Request):
 auth.identity(request)
 city=' '.join(body.city.split())
 state=body.state.upper()
 if not city or city.casefold()=='all' or not re.fullmatch('[A-Z]{2}',state) or any(char in city for char in ',;'):
  raise HTTPException(422,'Enter a city and two-letter state abbreviation')
 existing=next((market for market in configured_markets() if market[0].casefold()==city.casefold()),None)
 if existing:
  if existing[1]!=state:raise HTTPException(409,'That city name is already configured for a different state')
  return {'city':existing[0],'state':state}
 write_feed_setting('market:'+city.casefold(),{'city':city,'state':state})
 return {'city':city,'state':state}

@app.put('/api/admin/sync-access')
def set_sync_admin(body:SyncAdminBody,request:Request):
 claims=auth.identity(request)
 if not claims or not auth.is_owner(claims):raise HTTPException(403,'Owner access is required')
 email=clean_email(body.email)
 import boto3
 from botocore.exceptions import BotoCoreError, ClientError
 client=boto3.client('cognito-idp')
 pool=os.environ['HOMESCOPE_USER_POOL_ID']
 try:
  users=[]
  for page in client.get_paginator('list_users').paginate(UserPoolId=pool,Filter=f'email = "{email}"'):
   for user in page.get('Users',[]):
    attrs={attr['Name']:attr['Value'] for attr in user.get('Attributes',[])}
    if user.get('Enabled') and user['Username'].lower().startswith('google_') and attrs.get('email_verified')=='true' and attrs.get('sub'):
     users.append((user['Username'],attrs['sub']))
  if len(users)!=1:raise HTTPException(404,'Ask that user to sign in with Google first, then enter their verified email')
  update=client.admin_add_user_to_group if body.enabled else client.admin_remove_user_from_group
  username,subject=users[0]
  if not body.enabled:write_feed_setting('alert_access:'+subject,{'enabled':False})
  update(UserPoolId=pool,Username=username,GroupName='admins')
  if body.enabled:write_feed_setting('alert_access:'+subject,{'enabled':True})
 except (BotoCoreError,ClientError):
  raise HTTPException(502,'Could not update sync access in Cognito') from None
 return {'enabled':body.enabled}

class CitySchedule(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 enabled:bool

class WatchBody(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 email:str=Field(default="",max_length=254)
 budget:Optional[float]=Field(default=None,gt=0,le=100000)
 keyword:str=Field(default='',max_length=100)
 neighborhood:str=Field(default='',max_length=80)
 alert_hour:int=Field(default=11,ge=0,le=23)
 property_type:str=Field(default='all',pattern='^(all|House|Apartment)$')

class UnsubscribeBody(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 email:str=Field(default="",max_length=254)

def can_manage_sync(claims):
 if auth.is_owner(claims):return True
 if not auth.is_admin(claims):return False
 access=read_feed_setting('alert_access:'+claims['sub'])
 return not access or access['enabled']

def require_admin(request):
 if auth.required() and not can_manage_sync(auth.identity(request)):
  raise HTTPException(403,'Owner or approved sync access is required')

def require_market(city):
 for name,_ in configured_markets():
  if name.casefold()==city.strip().casefold():return name
 raise HTTPException(400,'This city is not in RENTCAST_MARKETS')

def clean_email(value):
 email=value.strip().lower()
 if not re.fullmatch(r'[a-z0-9.!#$%&*+/=?^_~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+',email):
  raise HTTPException(422,'Enter a valid email address')
 return email

def rentcast_enabled():
 return bool(os.getenv('RENTCAST_API_KEY','').strip()) or os.getenv('HOMESCOPE_RENTCAST_ENABLED')=='true'

@app.get('/api/feed/status')
def feed_status(city:str,request:Request):
 auth.identity(request)
 configured=any(name.casefold()==city.casefold() for name,_ in configured_markets())
 rentcast_ready=rentcast_enabled() and (not auth.required() or city.casefold()==PREVIEW_CITY.casefold())
 return {'configured':configured and rentcast_ready,
         'schedule_enabled':configured and bool(read_feed_setting('schedule:'+city.casefold())),
         'runner_enabled':os.getenv('HOMESCOPE_DAILY_ENABLED','false').lower()=='true',
         'email_enabled':bool(topic_prefix())}

@app.put('/api/feed/schedule')
def city_schedule(body:CitySchedule,request:Request):
 require_admin(request)
 city=require_market(body.city)
 write_feed_setting('schedule:'+city.casefold(),{'city':city} if body.enabled else None)
 return {'schedule_enabled':body.enabled}

def account_watch_key(city,claims,email):
 if claims:return sha256(f"account|{claims['sub']}|{city.casefold()}".encode()).hexdigest()
 return watch_key(city,email)

@app.put('/api/feed/watch')
def subscribe(body:WatchBody,request:Request):
 claims=auth.identity(request)
 require_admin(request)
 city=require_market(body.city)
 email=clean_email(auth.verified_email(request,claims) if claims else body.email)
 if not topic_prefix():raise HTTPException(503,'Email subscriptions are not configured')
 if body.budget is None and not body.keyword.strip() and not body.neighborhood.strip() and body.property_type=='all':
  raise HTTPException(422,'Set a monthly budget, neighborhood, keyword, or listing type')
 key=account_watch_key(city,claims, email)
 watch=body.model_dump()
 watch.update(city=city,email=email,keyword=body.keyword.strip(),neighborhood=locations.normalize_place(body.neighborhood),key=key)
 if claims:
  watch.update(subject=claims['sub'],privileged=True)
  if auth.is_owner(claims):write_feed_setting('alert_access:'+claims['sub'],{'enabled':True})
 previous=read_feed_setting('watch:'+key) or {}
 try:
  topic,pending=subscribe_watch(key,email)
  if previous.get('topic') and previous['topic']!=topic:
   delete_watch_topic(previous['topic'])
 except Exception:
  raise HTTPException(502,'Could not configure the email subscription') from None
 watch['topic']=topic
 write_feed_setting('watch:'+key,watch)
 return {'subscribed':True,'confirmation_required':pending}

@app.delete('/api/feed/watch')
def unsubscribe(body:UnsubscribeBody,request:Request):
 claims=auth.identity(request)
 email='' if claims else clean_email(body.email)
 key=account_watch_key(body.city.strip(),claims,email)
 previous=read_feed_setting('watch:'+key) or {}
 try:
  delete_watch_topic(previous.get('topic'))
 except Exception:
  raise HTTPException(502,'Could not remove the email subscription') from None
 write_feed_setting('watch:'+key,None)
 write_feed_setting('notices:'+key,None)
 return {'subscribed':False}

class RentCastConnection(BaseModel):
 api_key:SecretStr
 free_remaining:StrictInt=Field(ge=0,le=rentcast_account.FREE_LIMIT)


class RentCastRefresh(BaseModel):
 property_type:Literal['Apartment','House']='Apartment'
 confirmed_request:Optional[str]=Field(default=None,pattern=r'^[a-f0-9]{64}$')


def rentcast_subject(request):
 subject=require_account(request)['sub']
 if not os.getenv('HOMESCOPE_RENTCAST_KEY_PREFIX'):
  raise HTTPException(503,'Private RentCast connections are unavailable on this server.')
 return subject


@app.get('/api/rentcast/account')
def rentcast_dashboard(request:Request):
 return rentcast_account.dashboard(rentcast_subject(request))


@app.put('/api/rentcast/account')
def connect_rentcast(body:RentCastConnection,request:Request):
 subject=rentcast_subject(request)
 key=body.api_key.get_secret_value().strip()
 if not key or len(key)>512 or any(not ('!'<=char<='~') for char in key):
  raise HTTPException(422,'Enter a valid RentCast API key.')
 if sha256(key.encode()).hexdigest()==os.getenv('HOMESCOPE_PREVIEW_KEY_HASH'):
  raise HTTPException(422,'Use a RentCast account separate from the public preview.')
 rentcast_account.connect(subject,key,body.free_remaining)
 return rentcast_account.dashboard(subject)


@app.delete('/api/rentcast/account')
def disconnect_rentcast(request:Request):
 subject=rentcast_subject(request)
 rentcast_account.disconnect(subject)
 return rentcast_account.dashboard(subject)


@app.post('/api/sync')
def sync(request:Request,city:str='',body:Optional[RentCastRefresh]=None):
 if not auth.required():
  if city and rentcast_enabled():city=require_market(city)
  try:
   return {'updated':sync_feed(city=city)}
  except Exception:
   raise HTTPException(502,'Feed sync failed. Check the server configuration and provider status.') from None

 subject=rentcast_subject(request)
 key=rentcast_account.read_key(subject,decrypt=True)
 if not key:raise HTTPException(409,'Connect your RentCast key in Settings and alerts to refresh listings.')
 city=require_market(city)
 state=next(state for name,state in configured_markets() if name==city)
 options=body or RentCastRefresh()
 endpoint='sale' if options.property_type=='House' else 'rental/long-term'
 try:
  result=rentcast_account.refresh(subject,key,city,state,endpoint,options.confirmed_request)
 except Exception as exc:
  request_context=(request.scope.get('aws.event') or {}).get('requestContext',{})
  logger.error('Private RentCast refresh failed (API request %s, error type %s)',
               request_context.get('requestId'),type(exc).__name__)
  raise HTTPException(502,'RentCast refresh failed. Check your key and subscription in the RentCast dashboard.') from None
 return result
@app.get('/')
def home():return FileResponse(WEB/'index.html')
app.mount('/',StaticFiles(directory=WEB,html=True),name='web')
try:
 from mangum import Mangum
 handler=Mangum(app)
except ImportError:handler=None
