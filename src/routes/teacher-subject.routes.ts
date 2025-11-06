import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const assignSubjectSchema = z.object({
  subjectId: z.string().uuid('Invalid subject ID format'),
});

/**
 * @swagger
 * /teachers/{id}/subjects:
 *   post:
 *     summary: Assign subject to teacher
 *     description: Assign a subject to a teacher (Admin and Super Admin only)
 *     tags: [Teacher Subjects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *             required:
 *               - subjectId
 *             properties:
 *               subjectId:
 *                 type: string
 *                 format: uuid
 *                 description: Subject ID to assign
 *     responses:
 *       201:
 *         description: Subject assigned successfully
 *       400:
 *         description: Subject already assigned or validation error
 *       404:
 *         description: Teacher or subject not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// POST /teachers/:id/subjects - Assign subject to teacher
router.post(
  '/:id/subjects',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = assignSubjectSchema.parse(req.body);

      // Verify teacher exists and belongs to institute
      const teacher = await prisma.user.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
          role: 'TEACHER',
          isActive: true,
        },
      });

      if (!teacher) {
        throw new AppError(404, 'Teacher not found or inactive');
      }

      // Verify subject exists and belongs to institute
      const subject = await prisma.subject.findFirst({
        where: {
          id: data.subjectId,
          instituteId: user.instituteId,
        },
      });

      if (!subject) {
        throw new AppError(404, 'Subject not found');
      }

      // Check if assignment already exists
      const existingAssignment = await prisma.teacherSubject.findUnique({
        where: {
          teacherId_subjectId: {
            teacherId: id,
            subjectId: data.subjectId,
          },
        },
      });

      if (existingAssignment) {
        throw new AppError(400, 'Teacher is already assigned to this subject');
      }

      // Create assignment
      const assignment = await prisma.teacherSubject.create({
        data: {
          teacherId: id,
          subjectId: data.subjectId,
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
          subject: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: `Subject ${subject.name} assigned to teacher ${teacher.firstName} ${teacher.lastName} successfully`,
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
 * /teachers/{id}/subjects:
 *   get:
 *     summary: List all subjects assigned to teacher
 *     description: Get a list of all subjects a teacher can teach
 *     tags: [Teacher Subjects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Teacher ID
 *     responses:
 *       200:
 *         description: List of subjects retrieved successfully
 *       404:
 *         description: Teacher not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// GET /teachers/:id/subjects - List teacher's subjects
router.get(
  '/:id/subjects',
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

      // Get all subject assignments
      const assignments = await prisma.teacherSubject.findMany({
        where: {
          teacherId: id,
        },
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
        data: assignments,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /teachers/{id}/subjects/{subjectId}:
 *   delete:
 *     summary: Remove subject from teacher
 *     description: Remove a subject assignment from a teacher (Admin and Super Admin only)
 *     tags: [Teacher Subjects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Teacher ID
 *       - in: path
 *         name: subjectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Subject ID
 *     responses:
 *       200:
 *         description: Subject removed from teacher successfully
 *       404:
 *         description: Assignment not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// DELETE /teachers/:id/subjects/:subjectId - Remove subject from teacher
router.delete(
  '/:id/subjects/:subjectId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id, subjectId } = req.params;

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

      // Verify assignment exists
      const assignment = await prisma.teacherSubject.findUnique({
        where: {
          teacherId_subjectId: {
            teacherId: id,
            subjectId,
          },
        },
        include: {
          subject: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!assignment) {
        throw new AppError(404, 'Subject assignment not found');
      }

      // Delete assignment
      await prisma.teacherSubject.delete({
        where: {
          teacherId_subjectId: {
            teacherId: id,
            subjectId,
          },
        },
      });

      res.json({
        success: true,
        message: `Subject ${assignment.subject.name} removed from teacher successfully`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
