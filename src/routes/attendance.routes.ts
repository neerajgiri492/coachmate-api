import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const markAttendanceSchema = z.object({
  studentId: z.string().uuid(),
  classId: z.string().uuid(),
  date: z.string().datetime(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  notes: z.string().optional(),
});

const bulkAttendanceSchema = z.object({
  classId: z.string().uuid(),
  date: z.string().datetime(),
  attendance: z.array(
    z.object({
      studentId: z.string().uuid(),
      status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
      notes: z.string().optional(),
    })
  ),
});

// GET /api/v1/attendance - Get attendance records
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { classId, studentId, startDate, endDate, page = 1, limit = 50 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      instituteId: user.instituteId,
    };

    if (classId) where.classId = classId;
    if (studentId) where.studentId = studentId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take,
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              rollNumber: true,
            },
          },
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
        orderBy: { date: 'desc' },
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        records,
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

// POST /api/v1/attendance - Mark attendance for single student
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'TEACHER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = markAttendanceSchema.parse(req.body);

      // Verify student belongs to institute
      const student = await prisma.student.findFirst({
        where: {
          id: data.studentId,
          instituteId: user.instituteId,
        },
      });

      if (!student) {
        throw new AppError(404, 'Student not found');
      }

      // Check if attendance already exists for this date
      const existing = await prisma.attendance.findFirst({
        where: {
          studentId: data.studentId,
          classId: data.classId,
          date: new Date(data.date),
        },
      });

      let attendance;
      if (existing) {
        // Update existing record
        attendance = await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            notes: data.notes,
          },
          include: {
            student: true,
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
      } else {
        // Create new record
        attendance = await prisma.attendance.create({
          data: {
            ...data,
            date: new Date(data.date),
            instituteId: user.instituteId,
            markedBy: user.id,
          },
          include: {
            student: true,
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
      }

      res.status(201).json({
        success: true,
        message: 'Attendance marked successfully',
        data: attendance,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/attendance/bulk - Mark attendance for multiple students
router.post(
  '/bulk',
  authorize('SUPER_ADMIN', 'ADMIN', 'TEACHER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = bulkAttendanceSchema.parse(req.body);

      // Verify class belongs to institute
      const classRecord = await prisma.class.findFirst({
        where: {
          id: data.classId,
          instituteId: user.instituteId,
        },
      });

      if (!classRecord) {
        throw new AppError(404, 'Class not found');
      }

      // Process attendance records
      const results = await Promise.all(
        data.attendance.map(async (record) => {
          // Check if record exists
          const existing = await prisma.attendance.findFirst({
            where: {
              studentId: record.studentId,
              classId: data.classId,
              date: new Date(data.date),
            },
          });

          if (existing) {
            // Update
            return prisma.attendance.update({
              where: { id: existing.id },
              data: {
                status: record.status,
                notes: record.notes,
              },
            });
          } else {
            // Create
            return prisma.attendance.create({
              data: {
                studentId: record.studentId,
                classId: data.classId,
                date: new Date(data.date),
                status: record.status,
                notes: record.notes,
                instituteId: user.instituteId,
                markedBy: user.id,
              },
            });
          }
        })
      );

      res.status(201).json({
        success: true,
        message: `Attendance marked for ${results.length} students`,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/attendance/stats/:studentId - Get attendance statistics for a student
router.get('/stats/:studentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const where: any = {
      studentId,
      instituteId: user.instituteId,
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate as string);
      if (endDate) where.date.lte = new Date(endDate as string);
    }

    const records = await prisma.attendance.findMany({
      where,
    });

    const stats = {
      total: records.length,
      present: records.filter((r) => r.status === 'PRESENT').length,
      absent: records.filter((r) => r.status === 'ABSENT').length,
      late: records.filter((r) => r.status === 'LATE').length,
      excused: records.filter((r) => r.status === 'EXCUSED').length,
      percentage: 0,
    };

    if (stats.total > 0) {
      stats.percentage = Math.round(((stats.present + stats.late) / stats.total) * 100);
    }

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
