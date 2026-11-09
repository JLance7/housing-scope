import csv, hmac, io, json, os, re, time
from datetime import timedelta
from api import auth, rentcast
from hashlib import sha256
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from api.storage import ROOT, TABLE, all_rows, init_db, monthly_cost, normalize, read_feed_setting, save_row, write_feed_setting
from api.sync_listings import configured_markets, sync_feed
from api.alerts import delete_watch_topic, subscribe_watch, topic_prefix, watch_key

WEB = ROOT / 'web'
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')

app=FastAPI(title='HomeScope API',version='1.0.0')
@app.on_event('startup')
def startup():
 if not TABLE:init_db()
 rows = all_rows()
 if not rows or any(
  row['id'] in {f'home-{i:02d}' for i in range(1, 9)} and row.get('source') == 'Sample data'
  for row in rows
 ):
  existing_ids = {row['id'] for row in rows}
  for item in json.loads((ROOT/'seed_listings.json').read_text(encoding='utf-8')):
   if item['id'] not in existing_ids:
    save_row(normalize(item))
 if not os.getenv('RENTCAST_API_KEY') and os.getenv('LISTING_FEED_URL') and os.getenv('SYNC_ON_START','false').lower()=='true':
  try:sync_feed()
  except Exception as e:print('Initial feed sync failed:',e)
class ImportBody(BaseModel):csv:str
class ListingBody(BaseModel):title:str;area:str;property_type:str='House';price:float=Field(ge=0);rent:Optional[float]=None;beds:float=0;baths:float=0;sqft:int=0;hoa_monthly:float=0;taxes_yearly:float=0;insurance_yearly:float=0;source:str='Manual entry';source_url:str=''
def visible_rows(saved_ids=None):
 rows=all_rows()
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
 return {'auth_required':True,'admin':auth.is_admin(claims),'owner':auth.is_owner(claims),'email':auth.verified_email(request,claims)}

def public(x):
 x=dict(x);x['monthly_cost']=monthly_cost(x);x['favorite']=bool(x.get('favorite',False));return x
@app.get('/api/health')
def health():return {'status':'ok','storage':'dynamodb' if TABLE else 'sqlite'}
@app.get('/api/listings')
def listings(request:Request,budget:float=Query(4200,ge=0),property_type:str='all',area:str='all',q:str='',sort:str='cost',affordable_only:bool=False,saved_only:bool=False):
 claims=auth.identity(request)
 saved_ids=account_favorites(claims) if claims else (
  {x['id'] for x in all_rows() if x.get('favorite')} if saved_only else None
 )
 arr=[public(x) for x in visible_rows(saved_ids if saved_only else None)]
 if claims:
  for x in arr:x['favorite']=x['id'] in saved_ids
 if property_type!='all':arr=[x for x in arr if x['property_type'].lower()==property_type.lower()]
 if area!='all':arr=[x for x in arr if x['area'].lower()==area.lower()]
 if q:arr=[x for x in arr if q.lower() in (x['title']+' '+x['area']+' '+x.get('address','')).lower()]
 if saved_only:arr=[x for x in arr if x.get('favorite')]
 if affordable_only:arr=[x for x in arr if x['monthly_cost']<=budget]
 key={'price':lambda x:x['price'],'change':lambda x:x.get('change_30d') or 0}.get(sort,lambda x:x['monthly_cost']);arr.sort(key=key);return arr
@app.get('/api/areas')
def areas(request:Request):
 auth.identity(request)
 groups={}
 for x in map(public,visible_rows()):groups.setdefault(x['area'],[]).append(x['monthly_cost'])
 return [{'name':k,'avg_monthly':round(sum(v)/len(v)),'count':len(v)} for k,v in sorted(groups.items())]
@app.post('/api/listings/{listing_id}/favorite')
def favorite(listing_id:str,request:Request):
 claims=auth.identity(request)
 item=next((x for x in all_rows() if str(x['id'])==listing_id),None)
 if not item:raise HTTPException(404,'Listing not found')
 if claims:
  from api.storage import set_account_favorite
  favorited=item['id'] not in account_favorites(claims)
  set_account_favorite(claims['sub'],item['id'],favorited)
  return {'id':listing_id,'favorite':favorited}
 item['favorite']=not bool(item.get('favorite'));save_row(item);return {'id':listing_id,'favorite':bool(item['favorite'])}
@app.post('/api/listings')
def create_listing(body:ListingBody,request:Request):
 if auth.required():require_admin(request,None)
 n=normalize(body.model_dump());n['id']=str(int(time.time()*1000));save_row(n);return public(n)
@app.post('/api/import')
def import_csv(body:ImportBody,request:Request):
 if auth.required():require_admin(request,None)
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
def add_market(body:MarketBody,request:Request,token:Optional[str]=Header(None,alias='X-Admin-Token')):
 if auth.required():auth.identity(request)
 else:require_admin(request,token)
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
 property_type:str=Field(default='all',pattern='^(all|House|Apartment)$')

class UnsubscribeBody(BaseModel):
 city:str=Field(min_length=1,max_length=80)
 email:str=Field(default="",max_length=254)

def require_admin(request,token):
 if auth.required():
  claims=auth.identity(request)
  access=read_feed_setting('alert_access:'+claims['sub'])
  if not auth.is_admin(claims) or (not auth.is_owner(claims) and access and not access['enabled']):
   raise HTTPException(403,'Owner or approved sync access is required')
  return
 if not ADMIN_TOKEN:raise HTTPException(503,'Configure ADMIN_TOKEN to change feed settings')
 if not token or not hmac.compare_digest(token.encode(),ADMIN_TOKEN.encode()):
  raise HTTPException(401,'Invalid admin token')

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
 rentcast_ready=rentcast_enabled()
 return {'configured':configured and rentcast_ready,
         'schedule_enabled':configured and bool(read_feed_setting('schedule:'+city.casefold())),
         'runner_enabled':os.getenv('HOMESCOPE_DAILY_ENABLED','false').lower()=='true',
         'email_enabled':bool(topic_prefix())}

@app.put('/api/feed/schedule')
def city_schedule(body:CitySchedule,request:Request,token:Optional[str]=Header(None,alias='X-Admin-Token')):
 require_admin(request,token)
 city=require_market(body.city)
 write_feed_setting('schedule:'+city.casefold(),{'city':city} if body.enabled else None)
 return {'schedule_enabled':body.enabled}

def account_watch_key(city,claims,email):
 if claims:return sha256(f"account|{claims['sub']}|{city.casefold()}".encode()).hexdigest()
 return watch_key(city,email)

@app.put('/api/feed/watch')
def subscribe(body:WatchBody,request:Request,token:Optional[str]=Header(None,alias='X-Admin-Token')):
 claims=auth.identity(request)
 require_admin(request,token)
 city=require_market(body.city)
 email=clean_email(auth.verified_email(request,claims) if claims else body.email)
 if not topic_prefix():raise HTTPException(503,'Email subscriptions are not configured')
 if body.budget is None and not body.keyword.strip() and body.property_type=='all':
  raise HTTPException(422,'Set a monthly budget, keyword, or listing type')
 key=account_watch_key(city,claims, email)
 watch=body.model_dump()
 watch.update(city=city,email=email,keyword=body.keyword.strip(),key=key)
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
def unsubscribe(body:UnsubscribeBody,request:Request,token:Optional[str]=Header(None,alias='X-Admin-Token')):
 claims=auth.identity(request)
 if claims is None:require_admin(request,token)
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

def invoke_etl(function,city):
 import boto3
 from botocore.config import Config

 client=boto3.client('lambda',config=Config(connect_timeout=2,read_timeout=26,retries={'total_max_attempts':1}))
 response=client.invoke(FunctionName=function,InvocationType='RequestResponse',
                        Payload=json.dumps({'mode':'manual','city':city}).encode())
 with response['Payload'] as payload:
  if response.get('FunctionError'):raise RuntimeError('ETL invocation failed')
  result=json.load(payload)
 if type(result.get('updated')) is not int:raise RuntimeError('Invalid ETL response')
 return result['updated']

@app.post('/api/sync')
def sync(request:Request,city:str='',header_token:Optional[str]=Header(None,alias='X-Admin-Token')):
 if auth.required():auth.identity(request)
 elif ADMIN_TOKEN or os.getenv('RENTCAST_API_KEY','').strip():require_admin(request,header_token)
 if city and rentcast_enabled():city=require_market(city)
 try:
  function=os.getenv('HOMESCOPE_SYNC_FUNCTION','')
  if function:return {'updated':invoke_etl(function,city)}
  if auth.required():raise RuntimeError('ETL function is not configured')
  return {'updated':sync_feed(city=city)}
 except Exception:raise HTTPException(502,'Feed sync failed. Check the server configuration and provider status.') from None
@app.get('/')
def home():return FileResponse(WEB/'index.html')
app.mount('/',StaticFiles(directory=WEB,html=True),name='web')
try:
 from mangum import Mangum
 handler=Mangum(app)
except ImportError:handler=None
