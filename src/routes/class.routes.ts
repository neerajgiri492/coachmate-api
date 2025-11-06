import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createClassSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  schedule: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  schedule: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});

const addSubjectSchema = z.object({
  subjectIds: z.array(z.string().uuid()).min(1),
});

const removeSubjectSchema = z.object({
  subjectId: z.string().uuid(),
});

const assignStudentsSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1),
});

// GET /api/v1/classes - List all classes
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { isActive, teacherId, page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      instituteId: user.instituteId,
    };

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (teacherId) {
      where.timetables = {
        some: {
          teacherId: teacherId,
        },
      };
    }

    const [classes, total] = await Promise.all([
      prisma.class.findMany({
        where,
        skip,
        take,
        include: {
          timetables: {
            select: {
              id: true,
              subject: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
              teacher: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.class.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        classes,
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

// GET /api/v1/classes/:id - Get single class with students
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const classData = await prisma.class.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
      include: {
        timetables: {
          include: {
            subject: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            teacher: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                employeeId: true,
              },
            },
          },
        },
        students: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            rollNumber: true,
            email: true,
            phone: true,
            isActive: true,
          },
          orderBy: {
            firstName: 'asc',
          },
        },
        _count: {
          select: {
            students: true,
          },
        },
      },
    });

    if (!classData) {
      throw new AppError(404, 'Class not found');
    }

    res.json({
      success: true,
      data: classData,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/classes - Create new class
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = createClassSchema.parse(req.body);

      // Create class without subjects (subjects should be added via timetable separately)
      const classData = await prisma.class.create({
        data: {
          name: data.name,
          description: data.description,
          schedule: data.schedule,
          capacity: data.capacity,
          isActive: data.isActive ?? true,
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          endDate: data.endDate ? new Date(data.endDate) : null,
          instituteId: user.instituteId,
        },
        include: {
          timetables: {
            include: {
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
      });

      res.status(201).json({
        success: true,
        message: 'Class created successfully',
        data: classData,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/classes/:id - Update class
router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = updateClassSchema.parse(req.body);

      // Check if class exists and belongs to institute
      const existingClass = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!existingClass) {
        throw new AppError(404, 'Class not found');
      }

      const classData = await prisma.class.update({
        where: { id },
        data: {
          ...data,
          ...(data.startDate && { startDate: new Date(data.startDate) }),
          ...(data.endDate && { endDate: new Date(data.endDate) }),
        },
        include: {
          timetables: {
            include: {
              subject: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
              teacher: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
      });

      res.json({
        success: true,
        message: 'Class updated successfully',
        data: classData,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/classes/:id - Delete class
router.delete(
  '/:id',
  authorize('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Check if class exists and belongs to institute
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
        include: {
          _count: {
            select: {
              students: true,
            },
          },
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Warn if class has students
      if (classData._count.students > 0) {
        throw new AppError(
          400,
          `Cannot delete class with ${classData._count.students} students. Please reassign students first.`
        );
      }

      await prisma.class.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Class deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/classes/:id/subjects - Get all subjects for a class
router.get(
  '/:id/subjects',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Verify class exists
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      const subjects = await prisma.timetable.findMany({
        where: { classId: id },
        include: {
          subject: {
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
            },
          },
        },
      });

      res.json({
        success: true,
        data: subjects,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/classes/:id/subjects - Add subjects to class
router.post(
  '/:id/subjects',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { subjectIds } = addSubjectSchema.parse(req.body);

      // Verify class exists
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify subjects exist and belong to institute
      const subjects = await prisma.subject.findMany({
        where: {
          id: { in: subjectIds },
          instituteId: user.instituteId,
        },
      });

      if (subjects.length !== subjectIds.length) {
        throw new AppError(404, 'One or more subjects not found');
      }

      // Add subjects to class via timetable (skip if already exists)
      for (const subjectId of subjectIds) {
        const existing = await prisma.timetable.findFirst({
          where: {
            classId: id,
            subjectId,
          },
        });

        if (!existing) {
          // Create timetable entry with required fields
          await prisma.timetable.create({
            data: {
              classId: id,
              subjectId,
              teacherId: '', // TODO: This should be assigned separately
              dayOfWeek: 'MONDAY', // Default value
              startTime: '09:00', // Default value
              endTime: '10:00', // Default value
            },
          });
        }
      }

      // Get updated class with all subjects
      const updatedClass = await prisma.class.findUnique({
        where: { id },
        include: {
          timetables: {
            include: {
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
      });

      res.json({
        success: true,
        message: `${subjectIds.length} subject(s) added to class successfully`,
        data: updatedClass,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/classes/:id/subjects/:subjectId - Remove subject from class
router.delete(
  '/:id/subjects/:subjectId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id, subjectId } = req.params;

      // Verify class exists
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify subject is associated with class via timetable
      const timetableEntry = await prisma.timetable.findFirst({
        where: {
          classId: id,
          subjectId,
        },
      });

      if (!timetableEntry) {
        throw new AppError(404, 'Subject not associated with this class');
      }

      // Remove subject from class via timetable
      await prisma.timetable.deleteMany({
        where: {
          classId: id,
          subjectId,
        },
      });

      res.json({
        success: true,
        message: 'Subject removed from class successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/classes/:id/students - Assign students to class
router.post(
  '/:id/students',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { studentIds } = assignStudentsSchema.parse(req.body);

      // Verify class exists
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
        include: {
          _count: {
            select: {
              students: true,
            },
          },
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Check max students limit
      if (classData.capacity) {
        const newTotal = classData._count.students + studentIds.length;
        if (newTotal > classData.capacity) {
          throw new AppError(
            400,
            `Cannot assign students. Class capacity: ${classData.capacity}, Current: ${classData._count.students}, Trying to add: ${studentIds.length}`
          );
        }
      }

      // Verify all students belong to institute
      const students = await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          instituteId: user.instituteId,
        },
      });

      if (students.length !== studentIds.length) {
        throw new AppError(400, 'One or more students not found');
      }

      // Assign students to class
      await prisma.student.updateMany({
        where: {
          id: { in: studentIds },
        },
        data: {
          classId: id,
        },
      });

      // Get updated class with students
      const updatedClass = await prisma.class.findUnique({
        where: { id },
        include: {
          students: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              rollNumber: true,
            },
          },
          _count: {
            select: {
              students: true,
            },
          },
        },
      });

      res.json({
        success: true,
        message: `${studentIds.length} student(s) assigned to class successfully`,
        data: updatedClass,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/classes/:id/students/:studentId - Remove student from class
router.delete(
  '/:id/students/:studentId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id, studentId } = req.params;

      // Verify class exists
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify student exists and is in this class
      const student = await prisma.student.findFirst({
        where: {
          id: studentId,
          classId: id,
          instituteId: user.instituteId,
        },
      });

      if (!student) {
        throw new AppError(404, 'Student not found in this class');
      }

      // Remove student from class
      await prisma.student.update({
        where: { id: studentId },
        data: {
          classId: null,
        },
      });

      res.json({
        success: true,
        message: 'Student removed from class successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
