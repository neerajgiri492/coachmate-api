import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createTimetableSchema = z.object({
  classId: z.string().uuid('Invalid class ID format'),
  subjectId: z.string().uuid('Invalid subject ID format'),
  teacherId: z.string().uuid('Invalid teacher ID format'),
  dayOfWeek: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM'),
  room: z.string().optional(),
  isPrimary: z.boolean().optional().default(true),
});

const updateTimetableSchema = createTimetableSchema.partial();

/**
 * @swagger
 * /api/v1/timetable:
 *   get:
 *     summary: Get all timetable entries for institute
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: classId
 *         schema:
 *           type: string
 *         description: Filter by class ID
 *       - in: query
 *         name: teacherId
 *         schema:
 *           type: string
 *         description: Filter by teacher ID
 *       - in: query
 *         name: dayOfWeek
 *         schema:
 *           type: string
 *         description: Filter by day of week
 *     responses:
 *       200:
 *         description: Timetable entries retrieved successfully
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { classId, teacherId, dayOfWeek } = req.query;

    const where: any = {};

    if (classId) where.classId = classId;
    if (teacherId) where.teacherId = teacherId;
    if (dayOfWeek) where.dayOfWeek = dayOfWeek;

    const timetables = await prisma.timetable.findMany({
      where,
      include: {
        class: true,
        subject: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: timetables,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/classes/{classId}/timetable:
 *   get:
 *     summary: Get timetable for a specific class
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Class timetable retrieved successfully
 */
router.get('/classes/:classId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { classId } = req.params;

    // Verify class exists
    const classItem = await prisma.class.findUnique({
      where: { id: classId },
    });

    if (!classItem) {
      throw new AppError(404, 'Class not found');
    }

    const timetables = await prisma.timetable.findMany({
      where: { classId },
      include: {
        subject: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: timetables,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/classes/{classId}/timetable:
 *   post:
 *     summary: Create timetable entry for a class
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subjectId:
 *                 type: string
 *               teacherId:
 *                 type: string
 *               dayOfWeek:
 *                 type: string
 *                 enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *               room:
 *                 type: string
 *               isPrimary:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Timetable entry created successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Teacher already scheduled at this time
 */
router.post('/classes/:classId', authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { classId } = req.params;
    const user = req.user as any;

    // Validate input
    const validated = createTimetableSchema.parse(req.body);

    // Verify class exists and belongs to institute
    const classItem = await prisma.class.findFirst({
      where: {
        id: classId,
        instituteId: user.instituteId,
      },
    });

    if (!classItem) {
      throw new AppError(404, 'Class not found');
    }

    // Verify subject exists and belongs to institute
    const subject = await prisma.subject.findFirst({
      where: {
        id: validated.subjectId,
        instituteId: user.instituteId,
      },
    });

    if (!subject) {
      throw new AppError(404, 'Subject not found');
    }

    // Verify teacher exists and belongs to institute
    const teacher = await prisma.user.findFirst({
      where: {
        id: validated.teacherId,
        instituteId: user.instituteId,
        role: 'TEACHER',
      },
    });

    if (!teacher) {
      throw new AppError(404, 'Teacher not found');
    }

    // Verify teacher is qualified to teach this subject
    const qualification = await prisma.teacherSubject.findFirst({
      where: {
        teacherId: validated.teacherId,
        subjectId: validated.subjectId,
      },
    });

    if (!qualification) {
      throw new AppError(400, 'Teacher is not qualified to teach this subject');
    }

    // Check for double-booking (teacher at same time)
    const existingConflict = await prisma.timetable.findFirst({
      where: {
        teacherId: validated.teacherId,
        dayOfWeek: validated.dayOfWeek,
        startTime: validated.startTime,
      },
    });

    if (existingConflict) {
      throw new AppError(409, 'Teacher is already scheduled at this time');
    }

    // Check if this exact combination already exists
    const existing = await prisma.timetable.findFirst({
      where: {
        classId: validated.classId,
        subjectId: validated.subjectId,
        teacherId: validated.teacherId,
        dayOfWeek: validated.dayOfWeek,
        startTime: validated.startTime,
      },
    });

    if (existing) {
      throw new AppError(409, 'This timetable entry already exists');
    }

    const timetable = await prisma.timetable.create({
      data: {
        classId: validated.classId,
        subjectId: validated.subjectId,
        teacherId: validated.teacherId,
        dayOfWeek: validated.dayOfWeek,
        startTime: validated.startTime,
        endTime: validated.endTime,
        room: validated.room,
        isPrimary: validated.isPrimary,
        isActive: true,
      },
      include: {
        class: true,
        subject: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: timetable,
      message: 'Timetable entry created successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/timetable/{id}:
 *   get:
 *     summary: Get timetable entry by ID
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Timetable entry retrieved
 *       404:
 *         description: Timetable entry not found
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const timetable = await prisma.timetable.findUnique({
      where: { id },
      include: {
        class: true,
        subject: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!timetable) {
      throw new AppError(404, 'Timetable entry not found');
    }

    res.json({
      success: true,
      data: timetable,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/timetable/{id}:
 *   put:
 *     summary: Update timetable entry
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Timetable entry updated successfully
 *       404:
 *         description: Timetable entry not found
 */
router.put('/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const validated = updateTimetableSchema.parse(req.body);

    // Verify timetable exists
    const existing = await prisma.timetable.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!existing) {
      throw new AppError(404, 'Timetable entry not found');
    }

    // If changing teacher or subject, verify new teacher is qualified
    if (validated.teacherId && validated.subjectId) {
      const qualification = await prisma.teacherSubject.findFirst({
        where: {
          teacherId: validated.teacherId,
          subjectId: validated.subjectId,
        },
      });

      if (!qualification) {
        throw new AppError(400, 'Teacher is not qualified to teach this subject');
      }
    }

    // If changing time, check for conflicts
    if (validated.dayOfWeek || validated.startTime) {
      const dayOfWeek = validated.dayOfWeek || existing.dayOfWeek;
      const startTime = validated.startTime || existing.startTime;
      const teacherId = validated.teacherId || existing.teacherId;

      const conflict = await prisma.timetable.findFirst({
        where: {
          id: { not: id },
          teacherId,
          dayOfWeek,
          startTime,
        },
      });

      if (conflict) {
        throw new AppError(409, 'Teacher is already scheduled at this time');
      }
    }

    const updated = await prisma.timetable.update({
      where: { id },
      data: {
        ...validated,
      },
      include: {
        class: true,
        subject: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: updated,
      message: 'Timetable entry updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/timetable/{id}:
 *   delete:
 *     summary: Delete timetable entry
 *     tags: [Timetable]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Timetable entry deleted successfully
 *       404:
 *         description: Timetable entry not found
 */
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify timetable exists
    const existing = await prisma.timetable.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError(404, 'Timetable entry not found');
    }

    await prisma.timetable.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Timetable entry deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
