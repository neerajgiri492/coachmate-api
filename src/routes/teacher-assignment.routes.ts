import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * components:
 *   schemas:
 *     AssignTeacherInput:
 *       type: object
 *       required:
 *         - teacherId
 *       properties:
 *         teacherId:
 *           type: string
 *           format: uuid
 *           description: ID of the teacher to assign
 *           example: 123e4567-e89b-12d3-a456-426614174000
 *         isPrimary:
 *           type: boolean
 *           description: Whether this is the primary teacher for the class
 *           default: false
 *           example: true
 *         assignedAt:
 *           type: string
 *           format: date-time
 *           description: Assignment date (defaults to now)
 *           example: 2025-01-15T10:00:00Z
 */

// Validation schemas
const assignTeacherSchema = z.object({
  teacherId: z.string().uuid('Invalid teacher ID format'),
  isPrimary: z.boolean().optional().default(false),
  assignedAt: z.string().datetime().optional(),
});

const updateAssignmentSchema = z.object({
  isPrimary: z.boolean(),
});

/**
 * @swagger
 * /classes/{id}/teachers:
 *   get:
 *     summary: List all teachers assigned to a class
 *     description: Get a list of all teachers assigned to a specific class with their assignment details
 *     tags: [Class Teachers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Class ID
 *     responses:
 *       200:
 *         description: List of assigned teachers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       teacher:
 *                         type: object
 *                       isPrimary:
 *                         type: boolean
 *                       assignedAt:
 *                         type: string
 *                         format: date-time
 *       404:
 *         description: Class not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// GET /classes/:id/teachers - List all teachers for a class
router.get(
  '/:id/teachers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Verify class exists and belongs to institute
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Get all teacher assignments
      const assignments = await prisma.timetable.findMany({
        where: {
          classId: id,
        },
        include: {
          teacher: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              employeeId: true,
              isActive: true,
              teacherSubjects: {
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
          },
        },
        orderBy: [
          { isPrimary: 'desc' }, // Primary teachers first
          { createdAt: 'asc' }, // Then by creation date
        ],
      });

      res.json({
        success: true,
        data: assignments,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /classes/{id}/teachers:
 *   post:
 *     summary: Assign a teacher to a class
 *     description: Assign a teacher to a class. Validates teacher exists, belongs to institute, and can teach the class's subjects
 *     tags: [Class Teachers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Class ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssignTeacherInput'
 *     responses:
 *       201:
 *         description: Teacher assigned successfully
 *       400:
 *         description: Validation error or teacher already assigned
 *       404:
 *         description: Class or teacher not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// POST /classes/:id/teachers - Assign teacher to class
router.post(
  '/:id/teachers',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = assignTeacherSchema.parse(req.body);

      // Verify class exists and belongs to institute
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
            },
          },
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify teacher exists and belongs to institute
      const teacher = await prisma.user.findFirst({
        where: {
          id: data.teacherId,
          instituteId: user.instituteId,
          role: 'TEACHER',
          isActive: true,
        },
        include: {
          teacherSubjects: {
            include: {
              subject: true,
            },
          },
        },
      });

      if (!teacher) {
        throw new AppError(404, 'Teacher not found or inactive');
      }

      // Verify teacher can teach at least one subject in this class
      const classSubjectIds = classData.timetables.map((tt: any) => tt.subjectId);
      const canTeachSubject = teacher.teacherSubjects.some(
        (ts: any) => classSubjectIds.includes(ts.subjectId)
      );

      if (!canTeachSubject) {
        const classSubjectNames = classData.timetables
          .map((tt: any) => tt.subject.name)
          .join(', ');
        throw new AppError(
          400,
          `Teacher cannot teach any subjects in this class (${classSubjectNames}). Teacher's subjects: ${teacher.teacherSubjects.map((ts: any) => ts.subject.name).join(', ') || 'None'}`
        );
      }

      // Check if teacher is already assigned to this class
      const existingAssignment = await prisma.timetable.findFirst({
        where: {
          classId: id,
          teacherId: data.teacherId,
        },
      });

      if (existingAssignment) {
        throw new AppError(400, 'Teacher is already assigned to this class');
      }

      // If setting as primary, remove primary status from other teachers
      if (data.isPrimary) {
        await prisma.timetable.updateMany({
          where: {
            classId: id,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        });
      }

      // Create assignment
      const assignment = await prisma.timetable.create({
        data: {
          classId: id,
          teacherId: data.teacherId,
          isPrimary: data.isPrimary,
          subjectId: classData.timetables[0]?.subjectId || '', // Use first subject as default
          dayOfWeek: 'MONDAY', // Default day
          startTime: '09:00', // Default time
          endTime: '10:00', // Default time
        },
        include: {
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
          class: {
            select: {
              id: true,
              name: true,
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
          },
        },
      });

      res.status(201).json({
        success: true,
        message: `Teacher ${teacher.firstName} ${teacher.lastName} assigned to class successfully`,
        data: assignment,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /classes/{id}/teachers/{teacherId}:
 *   put:
 *     summary: Update teacher assignment
 *     description: Update a teacher's assignment details (e.g., change primary status)
 *     tags: [Class Teachers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Class ID
 *       - in: path
 *         name: teacherId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Teacher ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isPrimary:
 *                 type: boolean
 *                 description: Set as primary teacher
 *     responses:
 *       200:
 *         description: Assignment updated successfully
 *       404:
 *         description: Assignment not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// PUT /classes/:id/teachers/:teacherId - Update teacher assignment
router.put(
  '/:id/teachers/:teacherId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id, teacherId } = req.params;
      const data = updateAssignmentSchema.parse(req.body);

      // Verify class exists and belongs to institute
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify assignment exists
      const assignment = await prisma.timetable.findFirst({
        where: {
          classId: id,
          teacherId,
        },
      });

      if (!assignment) {
        throw new AppError(404, 'Teacher assignment not found');
      }

      // If setting as primary, remove primary status from other teachers
      if (data.isPrimary) {
        await prisma.timetable.updateMany({
          where: {
            classId: id,
            isPrimary: true,
            NOT: {
              teacherId,
            },
          },
          data: {
            isPrimary: false,
          },
        });
      }

      // Update assignment
      const updatedAssignment = await prisma.timetable.update({
        where: {
          id: assignment.id,
        },
        data: {
          isPrimary: data.isPrimary,
        },
        include: {
          teacher: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          class: {
            select: {
              id: true,
              name: true,
              timetables: {
                include: {
                  subject: {
                    select: {
                      name: true,
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
        message: 'Teacher assignment updated successfully',
        data: updatedAssignment,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /classes/{id}/teachers/{teacherId}:
 *   delete:
 *     summary: Remove teacher from class
 *     description: Remove a teacher's assignment from a class
 *     tags: [Class Teachers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Class ID
 *       - in: path
 *         name: teacherId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Teacher ID
 *     responses:
 *       200:
 *         description: Teacher removed from class successfully
 *       404:
 *         description: Assignment not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// DELETE /classes/:id/teachers/:teacherId - Remove teacher from class
router.delete(
  '/:id/teachers/:teacherId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id, teacherId } = req.params;

      // Verify class exists and belongs to institute
      const classData = await prisma.class.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!classData) {
        throw new AppError(404, 'Class not found');
      }

      // Verify assignment exists
      const assignment = await prisma.timetable.findFirst({
        where: {
          classId: id,
          teacherId,
        },
        include: {
          teacher: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!assignment) {
        throw new AppError(404, 'Teacher assignment not found');
      }

      // Delete assignment
      await prisma.timetable.delete({
        where: {
          id: assignment.id,
        },
      });

      res.json({
        success: true,
        message: `Teacher ${assignment.teacher.firstName} ${assignment.teacher.lastName} removed from class successfully`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
