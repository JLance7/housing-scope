"""Identity from the API Gateway JWT authorizer for the cloud deployment."""
import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException


def required():
    return os.getenv('HOMESCOPE_AUTH_REQUIRED', '').lower() == 'true'


def identity(request):
    if not required():
        return None
    event = request.scope.get('aws.event') or {}
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    if claims.get('token_use') != 'access' or not claims.get('sub'):
        raise HTTPException(401, 'Sign in with Google to continue')
    return claims


def groups_for(claims):
    groups = claims.get('cognito:groups', [])
    if isinstance(groups, str):
        groups = [name.strip(' "\'') for name in groups.strip('[]').split(',')]
    return groups


def is_owner(claims):
    return 'owners' in groups_for(claims)


def is_admin(claims):
    return is_owner(claims) or 'admins' in groups_for(claims)


def verified_email(request, claims):
    origin = os.environ['HOMESCOPE_COGNITO_ORIGIN']
    query = Request(origin + '/oauth2/userInfo', headers={
        'Authorization': request.headers.get('Authorization', ''),
        'Accept': 'application/json',
    })
    try:
        with urlopen(query, timeout=5) as response:
            profile = json.load(response)
    except (URLError, TimeoutError, ValueError):
        raise HTTPException(502, 'Could not verify the account email') from None
    email = profile.get('email')
    if (profile.get('sub') != claims['sub'] or not email
            or str(profile.get('email_verified')).lower() != 'true'):
        raise HTTPException(403, 'A verified Google account email is required')
    return email.strip().lower()

