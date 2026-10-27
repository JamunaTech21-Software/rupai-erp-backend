import { createHmac, timingSafeEqual } from 'node:crypto';

/** Minimal HS256 JSON Web Tokens with node:crypto; the access token carries only the user id. */
export interface AccessClaims {
  sub: string;
  iat: number;
  exp: number;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function signature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signAccessToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ sub: userId, iat, exp: iat + ttlSeconds } satisfies AccessClaims));
  const data = `${HEADER}.${payload}`;
  return `${data}.${signature(data, secret)}`;
}

/** The claims of a valid, unexpired token; undefined for anything else. */
export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims | undefined {
  const [header, payload, sig] = token.split('.');
  if (!header || !payload || !sig || header !== HEADER) return undefined;
  const expected = Buffer.from(signature(`${header}.${payload}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AccessClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || typeof claims.iat !== 'number')
      return undefined;
    if (claims.exp * 1000 <= now) return undefined;
    return claims as AccessClaims;
  } catch {
    return undefined;
  }
}
