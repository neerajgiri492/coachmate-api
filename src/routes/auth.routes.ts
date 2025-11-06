import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '@/utils/jwt';
import { AppError } from '@/middleware/errorHandler';
import { authenticate } from '@/middleware/auth';

const router: ReturnType<typeof Router> = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  instituteName: z.string().min(1),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new AppError(400, 'Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);

    // Create institute and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create institute
      const institute = await tx.institute.create({
        data: {
          name: data.instituteName,
          email: data.email,
          phone: data.phone,
        },
      });

      // Create user as SUPER_ADMIN
      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: 'SUPER_ADMIN',
          instituteId: institute.id,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          instituteId: true,
        },
      });

      return { user, institute };
    });

    // Generate tokens
    const accessToken = generateAccessToken({
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      instituteId: result.user.instituteId!,
    });

    const refreshToken = generateRefreshToken({
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      instituteId: result.user.instituteId!,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: result.user,
        institute: result.institute,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/login
router.post('/login', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = loginSchema.parse(req.body);

    passport.authenticate('local', { session: false }, (err: any, user: any, info: any) => {
      if (err) {
        return next(err);
      }

      if (!user) {
        throw new AppError(401, info?.message || 'Invalid credentials');
      }

      // Generate tokens
      const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        instituteId: user.instituteId,
      });

      const refreshToken = generateRefreshToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        instituteId: user.instituteId,
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          tokens: {
            accessToken,
            refreshToken,
          },
        },
      });
    })(req, res, next);
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        instituteId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Invalid refresh token');
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      instituteId: user.instituteId!,
    });

    const newRefreshToken = generateRefreshToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      instituteId: user.instituteId!,
    });

    res.json({
      success: true,
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        instituteId: true,
        institute: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: userData,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
