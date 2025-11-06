import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * components:
 *   schemas:
 *     SubjectInput:
 *       type: object
 *       required:
 *         - name
 *         - code
 *       properties:
 *         name:
 *           type: string
 *           description: Subject name
 *           example: Physics
 *         code:
 *           type: string
 *           description: Unique subject code
 *           example: PHY101
 *         description:
 *           type: string
 *           description: Subject description
 *           example: Physics for Class 9th
 */

// Validation schemas
const createSubjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Subject code is required'),
  description: z.string().optional(),
});

const updateSubjectSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
});

/**
 * @swagger
 * /subjects:
 *   get:
 *     summary: List all subjects
 *     description: Get a paginated list of all subjects for the institute with optional search
 *     tags: [Subjects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by subject name or code (case-insensitive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of subjects retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     subjects:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Subject'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
// GET /subjects - List all subjects
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { search, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      instituteId: user.instituteId,
    };

    // Search by name or code
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [subjects, total] = await Promise.all([
      prisma.subject.findMany({
        where,
        include: {
          _count: {
            select: {
              teacherSubjects: true,
              timetables: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.subject.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        subjects,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /subjects/:id - Get single subject
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const subject = await prisma.subject.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
      include: {
        teacherSubjects: {
          include: {
            teacher: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                employeeId: true,
              },
            },
          },
        },
        timetables: {
          include: {
            class: {
              select: {
                id: true,
                name: true,
                _count: {
                  select: { students: true },
                },
              },
            },
          },
        },
        _count: {
          select: {
            teacherSubjects: true,
            timetables: true,
          },
        },
      },
    });

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found',
      });
    }

    res.json({
      success: true,
      data: subject,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /subjects:
 *   post:
 *     summary: Create new subject
 *     description: Create a new subject (Admin and Super Admin only)
 *     tags: [Subjects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubjectInput'
 *     responses:
 *       201:
 *         description: Subject created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Subject'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
// POST /subjects - Create new subject
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const validatedData = createSubjectSchema.parse(req.body);

      // Check for duplicate code within institute
      const existing = await prisma.subject.findFirst({
        where: {
          instituteId: user.instituteId,
          code: validatedData.code,
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Subject with this code already exists',
        });
      }

      const subject = await prisma.subject.create({
        data: {
          ...validatedData,
          instituteId: user.instituteId,
        },
        include: {
          _count: {
            select: {
              teacherSubjects: true,
              timetables: true,
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        data: subject,
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

// PUT /subjects/:id - Update subject
router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const validatedData = updateSubjectSchema.parse(req.body);

      // Check subject exists and belongs to institute
      const existing = await prisma.subject.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }

      // If updating code, check for duplicates
      if (validatedData.code && validatedData.code !== existing.code) {
        const duplicate = await prisma.subject.findFirst({
          where: {
            instituteId: user.instituteId,
            code: validatedData.code,
            NOT: { id },
          },
        });

        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: 'Subject with this code already exists',
          });
        }
      }

      const subject = await prisma.subject.update({
        where: { id },
        data: validatedData,
        include: {
          _count: {
            select: {
              teacherSubjects: true,
              timetables: true,
            },
          },
        },
      });

      res.json({
        success: true,
        data: subject,
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

// DELETE /subjects/:id - Delete subject
router.delete(
  '/:id',
  authorize('SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;

      // Check subject exists and belongs to institute
      const subject = await prisma.subject.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
        include: {
          _count: {
            select: {
              timetables: true,
              teacherSubjects: true,
            },
          },
        },
      });

      if (!subject) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }

      // Check if subject is in use
      if (subject._count.timetables > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete subject. It is assigned to ${subject._count.timetables} class(es)`,
        });
      }

      await prisma.subject.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'Subject deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
