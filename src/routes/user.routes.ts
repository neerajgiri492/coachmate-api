import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['ADMIN', 'TEACHER', 'STAFF']),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

const updateUserRoleSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF']),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

// GET /api/v1/users - List all users
router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { role, isActive, page = 1, limit = 20 } = req.query;

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const where: any = {
        instituteId: user.instituteId,
      };

      if (role) {
        where.role = role;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      // Non-super admins can't see super admins
      if (user.role !== 'SUPER_ADMIN') {
        where.role = { not: 'SUPER_ADMIN' };
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            _count: {
              select: {
                timetables: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/users/:id - Get single user
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const targetUser = await prisma.user.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        teacherSubjects: {
          select: {
            subject: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        timetables: {
          select: {
            id: true,
            class: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                name: true,
              },
            },
            dayOfWeek: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    if (!targetUser) {
      throw new AppError(404, 'User not found');
    }

    // Non-super admins can't view super admins
    if (user.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw new AppError(403, 'Insufficient permissions');
    }

    res.json({
      success: true,
      data: targetUser,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/users - Create new user
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = createUserSchema.parse(req.body);

      // Only super admin can create admin users
      if (data.role === 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Only Super Admin can create Admin users');
      }

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (existingUser) {
        throw new AppError(400, 'Email already registered');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(data.password, 12);

      const newUser = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: data.role,
          instituteId: user.instituteId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: newUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id - Update user profile
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    // Users can only update their own profile unless they're admin
    if (id !== user.id && !['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
      throw new AppError(403, 'You can only update your own profile');
    }

    // Verify target user exists and belongs to institute
    const targetUser = await prisma.user.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
    });

    if (!targetUser) {
      throw new AppError(404, 'User not found');
    }

    // Non-super admins can't update super admins
    if (user.role !== 'SUPER_ADMIN' && targetUser.role === 'SUPER_ADMIN') {
      throw new AppError(403, 'Insufficient permissions');
    }

    // Check email uniqueness if changing email
    if (data.email && data.email !== targetUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (emailExists) {
        throw new AppError(400, 'Email already in use');
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...data,
        ...(data.email && { email: data.email.toLowerCase() }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
      },
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v1/users/:id/role - Update user role
router.patch(
  '/:id/role',
  authorize('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { role } = updateUserRoleSchema.parse(req.body);

      // Can't change your own role
      if (id === user.id) {
        throw new AppError(400, 'You cannot change your own role');
      }

      // Verify target user exists and belongs to institute
      const targetUser = await prisma.user.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!targetUser) {
        throw new AppError(404, 'User not found');
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { role },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      });

      res.json({
        success: true,
        message: 'User role updated successfully',
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/users/:id/status - Activate/deactivate user
router.patch(
  '/:id/status',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

      // Can't deactivate yourself
      if (id === user.id) {
        throw new AppError(400, 'You cannot deactivate your own account');
      }

      // Verify target user exists and belongs to institute
      const targetUser = await prisma.user.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!targetUser) {
        throw new AppError(404, 'User not found');
      }

      // Only super admin can deactivate admins
      if (targetUser.role === 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Only Super Admin can deactivate Admin users');
      }

      // Can't deactivate super admins
      if (targetUser.role === 'SUPER_ADMIN') {
        throw new AppError(400, 'Cannot deactivate Super Admin accounts');
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { isActive },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
        },
      });

      res.json({
        success: true,
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/users/:id/password - Change password
router.put(
  '/:id/password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      // Users can only change their own password
      if (id !== user.id) {
        throw new AppError(403, 'You can only change your own password');
      }

      // Get user with password
      const targetUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!targetUser) {
        throw new AppError(404, 'User not found');
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, targetUser.passwordHash);

      if (!isPasswordValid) {
        throw new AppError(401, 'Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      await prisma.user.update({
        where: { id },
        data: { passwordHash: newPasswordHash },
      });

      res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/users/:id - Delete user
router.delete(
  '/:id',
  authorize('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Can't delete yourself
      if (id === user.id) {
        throw new AppError(400, 'You cannot delete your own account');
      }

      // Verify target user exists and belongs to institute
      const targetUser = await prisma.user.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!targetUser) {
        throw new AppError(404, 'User not found');
      }

      // Can't delete super admins
      if (targetUser.role === 'SUPER_ADMIN') {
        throw new AppError(400, 'Cannot delete Super Admin accounts');
      }

      await prisma.user.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
