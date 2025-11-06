import jwt from 'jsonwebtoken';

interface TokenPayload {
  sub: string; // user id
  email: string;
  role: string;
  instituteId?: string;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'your-secret-key',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      issuer: 'coachmate-api',
      audience: 'coachmate-client',
    } as jwt.SignOptions
  );
}

export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      issuer: 'coachmate-api',
      audience: 'coachmate-client',
    } as jwt.SignOptions
  );
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(
    token,
    process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
    {
      issuer: 'coachmate-api',
      audience: 'coachmate-client',
    }
  ) as TokenPayload;
}
