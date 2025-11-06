import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(10),
  dateOfBirth: z.string().datetime(),
  guardianName: z.string().min(1),
  guardianPhone: z.string().min(10),
  address: z.string().optional(),
  enrollmentDate: z.string().datetime().optional(),
  classId: z.string().uuid().optional(),
});

// GET /api/v1/students - List all students
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { page = 1, limit = 20, search, classId } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      instituteId: user.instituteId,
    };

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (classId) {
      where.classId = classId;
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        skip,
        take,
        include: {
          class: {
            select: {
              id: true,
              name: true,
              timetables: {
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
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.student.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        students,
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
});

// GET /api/v1/students/:id - Get single student
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const student = await prisma.student.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
      include: {
        class: {
          include: {
            timetables: {
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
          },
        },
        attendance: {
          orderBy: { date: 'desc' },
          take: 10,
        },
        feeRecords: {
          orderBy: { dueDate: 'desc' },
          take: 10,
        },
      },
    });

    if (!student) {
      throw new AppError(404, 'Student not found');
    }

    res.json({
      success: true,
      data: student,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/students - Create new student
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = createStudentSchema.parse(req.body);

      const student = await prisma.student.create({
        data: {
          ...data,
          instituteId: user.instituteId,
          enrollmentDate: data.enrollmentDate ? new Date(data.enrollmentDate) : new Date(),
          dateOfBirth: new Date(data.dateOfBirth),
        },
        include: {
          class: {
            include: {
              timetables: {
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
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: 'Student created successfully',
        data: student,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/students/:id - Update student
router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = createStudentSchema.partial().parse(req.body);

      // Check if student exists and belongs to the institute
      const existingStudent = await prisma.student.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!existingStudent) {
        throw new AppError(404, 'Student not found');
      }

      const student = await prisma.student.update({
        where: { id },
        data: {
          ...data,
          ...(data.dateOfBirth && { dateOfBirth: new Date(data.dateOfBirth) }),
          ...(data.enrollmentDate && { enrollmentDate: new Date(data.enrollmentDate) }),
        },
        include: {
          class: {
            include: {
              timetables: {
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
            },
          },
        },
      });

      res.json({
        success: true,
        message: 'Student updated successfully',
        data: student,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/students/:id - Delete student
router.delete(
  '/:id',
  authorize('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Check if student exists and belongs to the institute
      const student = await prisma.student.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!student) {
        throw new AppError(404, 'Student not found');
      }

      await prisma.student.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Student deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
