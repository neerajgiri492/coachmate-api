import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import bcrypt from 'bcryptjs';
import { prisma } from '@coachmate/database';
import { logger } from '@/utils/logger';

export function configurePassport() {
  // Local Strategy for email/password login
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          // Find user by email
          const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
          });

          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          // Check if account is active
          if (!user.isActive) {
            return done(null, false, { message: 'Account is disabled' });
          }

          // Verify password
          const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
          if (!isPasswordValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          // Remove password hash from user object
          const { passwordHash, ...userWithoutPassword } = user;

          return done(null, userWithoutPassword);
        } catch (error) {
          logger.error('Local strategy error:', error);
          return done(error);
        }
      }
    )
  );

  // JWT Strategy for protected routes
  const jwtOptions: StrategyOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    issuer: 'coachmate-api',
    audience: 'coachmate-client',
  };

  passport.use(
    new JwtStrategy(jwtOptions, async (payload, done) => {
      try {
        // Find user by ID from JWT payload
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            instituteId: true,
          },
        });

        if (!user) {
          return done(null, false);
        }

        if (!user.isActive) {
          return done(null, false, { message: 'Account is disabled' });
        }

        return done(null, user);
      } catch (error) {
        logger.error('JWT strategy error:', error);
        return done(error, false);
      }
    })
  );
}
