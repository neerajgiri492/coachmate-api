import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createScheduleSchema = z.object({
  classId: z.string().uuid('Invalid class ID format'),
  dayOfWeek: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:MM'),
  room: z.string().optional(),
});

const updateScheduleSchema = createScheduleSchema.partial();

/**
 * @swagger
 * /api/v1/teachers/{id}/schedules:
 *   get:
 *     summary: Get teacher's weekly schedule
 *     tags: [Teacher Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Teacher ID
 *       - in: query
 *         name: dayOfWeek
 *         schema:
 *           type: string
 *           enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *         description: Filter by specific day
 *     responses:
 *       200:
 *         description: Teacher's schedule retrieved successfully
 *       404:
 *         description: Teacher not found
 */
router.get('/:id/schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;
    const { dayOfWeek } = req.query;

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

    const where: any = {
      teacherId: id,
    };

    if (dayOfWeek) {
      where.dayOfWeek = dayOfWeek;
    }

    const schedules = await prisma.timetable.findMany({
      where,
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
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: {
        teacherId: id,
        teacherName: `${teacher.firstName} ${teacher.lastName}`,
        schedules,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/teachers/{id}/schedules:
 *   post:
 *     summary: Create a schedule entry for teacher
 *     tags: [Teacher Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Teacher ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - classId
 *               - dayOfWeek
 *               - startTime
 *               - endTime
 *             properties:
 *               classId:
 *                 type: string
 *                 format: uuid
 *               dayOfWeek:
 *                 type: string
 *                 enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *               startTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *                 example: "09:00"
 *               endTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *                 example: "10:30"
 *               room:
 *                 type: string
 *                 example: "Room 101"
 *     responses:
 *       201:
 *         description: Schedule created successfully
 *       400:
 *         description: Validation error or time conflict
 *       404:
 *         description: Teacher or class not found
 */
router.post(
  '/:id/schedules',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = createScheduleSchema.parse(req.body);

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

      // Verify class exists and belongs to institute
      const classRecord = await prisma.class.findFirst({
        where: {
          id: data.classId,
          instituteId: user.instituteId,
        },
      });

      if (!classRecord) {
        throw new AppError(404, 'Class not found');
      }

      // Validate time range
      if (data.startTime >= data.endTime) {
        throw new AppError(400, 'End time must be after start time');
      }

      // Check for time conflicts
      const conflict = await prisma.timetable.findFirst({
        where: {
          teacherId: id,
          dayOfWeek: data.dayOfWeek,
          OR: [
            // New schedule starts during existing schedule
            {
              AND: [
                { startTime: { lte: data.startTime } },
                { endTime: { gt: data.startTime } },
              ],
            },
            // New schedule ends during existing schedule
            {
              AND: [
                { startTime: { lt: data.endTime } },
                { endTime: { gte: data.endTime } },
              ],
            },
            // New schedule completely contains existing schedule
            {
              AND: [
                { startTime: { gte: data.startTime } },
                { endTime: { lte: data.endTime } },
              ],
            },
          ],
        },
        include: {
          class: {
            select: {
              name: true,
            },
          },
        },
      });

      if (conflict) {
        throw new AppError(
          400,
          `Time conflict detected: Teacher already has a class "${conflict.class.name}" on ${data.dayOfWeek} from ${conflict.startTime} to ${conflict.endTime}`
        );
      }

      // Create schedule
      const schedule = await prisma.timetable.create({
        data: {
          teacherId: id,
          classId: data.classId,
          subjectId: '', // TODO: This should be provided in the request
          dayOfWeek: data.dayOfWeek,
          startTime: data.startTime,
          endTime: data.endTime,
          room: data.room,
        },
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
      });

      res.status(201).json({
        success: true,
        message: 'Schedule created successfully',
        data: schedule,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/v1/schedules/{id}:
 *   put:
 *     summary: Update a schedule entry
 *     tags: [Teacher Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Schedule ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               classId:
 *                 type: string
 *                 format: uuid
 *               dayOfWeek:
 *                 type: string
 *                 enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *               startTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *               endTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *               room:
 *                 type: string
 *     responses:
 *       200:
 *         description: Schedule updated successfully
 *       400:
 *         description: Validation error or time conflict
 *       404:
 *         description: Schedule not found
 */
router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = updateScheduleSchema.parse(req.body);

      // Check if schedule exists
      const existingSchedule = await prisma.timetable.findFirst({
        where: {
          id,
          teacher: {
            instituteId: user.instituteId,
          },
        },
      });

      if (!existingSchedule) {
        throw new AppError(404, 'Schedule not found');
      }

      // Verify class if provided
      if (data.classId) {
        const classRecord = await prisma.class.findFirst({
          where: {
            id: data.classId,
            instituteId: user.instituteId,
          },
        });

        if (!classRecord) {
          throw new AppError(404, 'Class not found');
        }
      }

      // Validate time range if both times are provided
      const startTime = data.startTime || existingSchedule.startTime;
      const endTime = data.endTime || existingSchedule.endTime;

      if (startTime >= endTime) {
        throw new AppError(400, 'End time must be after start time');
      }

      // Check for time conflicts (excluding current schedule)
      const dayOfWeek = data.dayOfWeek || existingSchedule.dayOfWeek;

      const conflict = await prisma.timetable.findFirst({
        where: {
          id: { not: id },
          teacherId: existingSchedule.teacherId,
          dayOfWeek: dayOfWeek,
          OR: [
            {
              AND: [
                { startTime: { lte: startTime } },
                { endTime: { gt: startTime } },
              ],
            },
            {
              AND: [
                { startTime: { lt: endTime } },
                { endTime: { gte: endTime } },
              ],
            },
            {
              AND: [
                { startTime: { gte: startTime } },
                { endTime: { lte: endTime } },
              ],
            },
          ],
        },
        include: {
          class: {
            select: {
              name: true,
            },
          },
        },
      });

      if (conflict) {
        throw new AppError(
          400,
          `Time conflict detected: Teacher already has a class "${conflict.class.name}" on ${dayOfWeek} from ${conflict.startTime} to ${conflict.endTime}`
        );
      }

      // Update schedule
      const schedule = await prisma.timetable.update({
        where: { id },
        data,
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
      });

      res.json({
        success: true,
        message: 'Schedule updated successfully',
        data: schedule,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/v1/schedules/{id}:
 *   delete:
 *     summary: Delete a schedule entry
 *     tags: [Teacher Schedule]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Schedule ID
 *     responses:
 *       200:
 *         description: Schedule deleted successfully
 *       404:
 *         description: Schedule not found
 */
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Check if schedule exists and belongs to institute
      const schedule = await prisma.timetable.findFirst({
        where: {
          id,
          teacher: {
            instituteId: user.instituteId,
          },
        },
      });

      if (!schedule) {
        throw new AppError(404, 'Schedule not found');
      }

      await prisma.timetable.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Schedule deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/v1/schedules/conflicts/check:
 *   post:
 *     summary: Check for schedule conflicts before creating
 *     tags: [Teacher Schedule]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - teacherId
 *               - dayOfWeek
 *               - startTime
 *               - endTime
 *             properties:
 *               teacherId:
 *                 type: string
 *                 format: uuid
 *               dayOfWeek:
 *                 type: string
 *                 enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]
 *               startTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *               endTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *               excludeScheduleId:
 *                 type: string
 *                 format: uuid
 *                 description: Schedule ID to exclude from conflict check (for updates)
 *     responses:
 *       200:
 *         description: Conflict check result
 */
router.post(
  '/conflicts/check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { teacherId, dayOfWeek, startTime, endTime, excludeScheduleId } = req.body;

      // Validate required fields
      if (!teacherId || !dayOfWeek || !startTime || !endTime) {
        throw new AppError(400, 'teacherId, dayOfWeek, startTime, and endTime are required');
      }

      // Verify teacher belongs to institute
      const teacher = await prisma.user.findFirst({
        where: {
          id: teacherId,
          instituteId: user.instituteId,
          role: 'TEACHER',
        },
      });

      if (!teacher) {
        throw new AppError(404, 'Teacher not found');
      }

      // Check for conflicts
      const where: any = {
        teacherId,
        dayOfWeek,
        OR: [
          {
            AND: [
              { startTime: { lte: startTime } },
              { endTime: { gt: startTime } },
            ],
          },
          {
            AND: [
              { startTime: { lt: endTime } },
              { endTime: { gte: endTime } },
            ],
          },
          {
            AND: [
              { startTime: { gte: startTime } },
              { endTime: { lte: endTime } },
            ],
          },
        ],
      };

      if (excludeScheduleId) {
        where.id = { not: excludeScheduleId };
      }

      const conflicts = await prisma.timetable.findMany({
        where,
        include: {
          class: {
            select: {
              id: true,
              name: true,
              timetables: {
                select: {
                  subject: {
                    select: {
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
        data: {
          hasConflict: conflicts.length > 0,
          conflicts,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
