import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createTeacherSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
});

const updateTeacherSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/teachers - List all teachers
router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { page = 1, limit = 10, search } = req.query;

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const where: any = {
        instituteId: user.instituteId,
        role: 'TEACHER',
      };

      // Search by name or email
      if (search) {
        where.OR = [
          { firstName: { contains: search as string, mode: 'insensitive' } },
          { lastName: { contains: search as string, mode: 'insensitive' } },
          { email: { contains: search as string, mode: 'insensitive' } },
        ];
      }

      const [teachers, total] = await Promise.all([
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
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          teachers,
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

// GET /api/v1/teachers/:id - Get single teacher
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const teacher = await prisma.user.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
        role: 'TEACHER',
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
        _count: {
          select: {
            timetables: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new AppError(404, 'Teacher not found');
    }

    res.json({
      success: true,
      data: teacher,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/teachers - Create new teacher
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = createTeacherSchema.parse(req.body);

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (existingUser) {
        throw new AppError(400, 'Email already registered');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(data.password, 12);

      const newTeacher = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: 'TEACHER',
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
        message: 'Teacher created successfully',
        data: newTeacher,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/teachers/:id - Update teacher
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;
    const data = updateTeacherSchema.parse(req.body);

    // Verify teacher exists and belongs to institute
    const teacher = await prisma.user.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
        role: 'TEACHER',
      },
    });

    if (!teacher) {
      throw new AppError(404, 'Teacher not found');
    }

    // Check email uniqueness if changing email
    if (data.email && data.email !== teacher.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (emailExists) {
        throw new AppError(400, 'Email already in use');
      }
    }

    const updatedTeacher = await prisma.user.update({
      where: { id },
      data: {
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        phone: data.phone ?? undefined,
        isActive: data.isActive ?? undefined,
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
      message: 'Teacher updated successfully',
      data: updatedTeacher,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/teachers/:id - Delete teacher
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Verify teacher exists and belongs to institute
      const teacher = await prisma.user.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
          role: 'TEACHER',
        },
      });

      if (!teacher) {
        throw new AppError(404, 'Teacher not found');
      }

      // Delete associated timetable entries and subject qualifications first
      await Promise.all([
        prisma.timetable.deleteMany({
          where: { teacherId: id },
        }),
        prisma.teacherSubject.deleteMany({
          where: { teacherId: id },
        }),
      ]);

      // Then delete the teacher user
      await prisma.user.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Teacher deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
