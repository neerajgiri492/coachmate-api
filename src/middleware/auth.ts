import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { AppError } from './errorHandler';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('jwt', { session: false }, (err: any, user: any, info: any) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      throw new AppError(401, info?.message || 'Unauthorized');
    }

    req.user = user;
    next();
  })(req, res, next);
};

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const user = req.user as any;
    if (!roles.includes(user.role)) {
      throw new AppError(403, 'Forbidden: Insufficient permissions');
    }

    next();
  };
};
