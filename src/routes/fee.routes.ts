import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@coachmate/database';
import { authenticate, authorize } from '@/middleware/auth';
import { AppError } from '@/middleware/errorHandler';

const router: ReturnType<typeof Router> = Router();

// All routes require authentication
router.use(authenticate);

// Validation schemas
const createFeeRecordSchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
  description: z.string().optional(),
  feeType: z.string(),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE']),
  transactionId: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/v1/fees - Get all fee records
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { studentId, status, page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      instituteId: user.instituteId,
    };

    if (studentId) where.studentId = studentId;
    if (status) where.status = status;

    const [records, total] = await Promise.all([
      prisma.feeRecord.findMany({
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
          payments: true,
        },
        orderBy: { dueDate: 'desc' },
      }),
      prisma.feeRecord.count({ where }),
    ]);

    // Convert Decimal to number for JSON response
    const formattedRecords = records.map((record: any) => ({
      ...record,
      amount: Number(record.amount),
      amountPaid: Number(record.amountPaid),
      amountDue: Number(record.amountDue),
      payments: record.payments?.map((p: any) => ({
        ...p,
        amount: Number(p.amount),
      })),
    }));

    res.json({
      success: true,
      data: {
        records: formattedRecords,
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

// GET /api/v1/fees/:id - Get single fee record
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    const record = await prisma.feeRecord.findFirst({
      where: {
        id,
        instituteId: user.instituteId,
      },
      include: {
        student: true,
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!record) {
      throw new AppError(404, 'Fee record not found');
    }

    // Convert Decimal to number for JSON response
    const formattedRecord = {
      ...record,
      amount: Number(record.amount),
      amountPaid: Number(record.amountPaid),
      amountDue: Number(record.amountDue),
      payments: record.payments?.map((p: any) => ({
        ...p,
        amount: Number(p.amount),
      })),
    };

    res.json({
      success: true,
      data: formattedRecord,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/fees - Create new fee record
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const data = createFeeRecordSchema.parse(req.body);

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

      const record = await prisma.feeRecord.create({
        data: {
          ...data,
          dueDate: new Date(data.dueDate),
          instituteId: user.instituteId,
          status: 'PENDING',
          amountPaid: 0,
          amountDue: data.amount,
        },
        include: {
          student: true,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Fee record created successfully',
        data: record,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/fees/:id/payment - Record payment for a fee
router.post(
  '/:id/payment',
  authorize('SUPER_ADMIN', 'ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const data = recordPaymentSchema.parse(req.body);

      // Get fee record
      const feeRecord = await prisma.feeRecord.findFirst({
        where: {
          id,
          instituteId: user.instituteId,
        },
      });

      if (!feeRecord) {
        throw new AppError(404, 'Fee record not found');
      }

      if (feeRecord.status === 'PAID') {
        throw new AppError(400, 'Fee already paid in full');
      }

      // Check if payment amount exceeds remaining amount
      if (data.amount > Number(feeRecord.amountDue)) {
        throw new AppError(400, 'Payment amount exceeds remaining amount due');
      }

      // Create payment and update fee record
      const result = await prisma.$transaction(async (tx) => {
        // Create payment record
        const payment = await tx.payment.create({
          data: {
            feeRecordId: id,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            transactionId: data.transactionId,
            notes: data.notes,
            receivedBy: user.id,
            paidAt: new Date(),
          },
        });

        // Update fee record
        // Convert Decimal to number before arithmetic to avoid invalid decimal strings
        const currentAmountPaid = Number(feeRecord.amountPaid);
        const totalAmount = Number(feeRecord.amount);
        const newAmountPaid = currentAmountPaid + data.amount;
        const newAmountDue = totalAmount - newAmountPaid;
        const newStatus = newAmountDue === 0 ? 'PAID' : newAmountPaid > 0 ? 'PARTIAL' : 'PENDING';

        const updatedFee = await tx.feeRecord.update({
          where: { id },
          data: {
            amountPaid: newAmountPaid,
            amountDue: newAmountDue,
            status: newStatus,
            ...(newStatus === 'PAID' && { paidAt: new Date() }),
          },
          include: {
            student: true,
            payments: true,
          },
        });

        return { payment, feeRecord: updatedFee };
      });

      // Convert Decimal to number for JSON response
      const formattedResult = {
        payment: {
          ...result.payment,
          amount: Number(result.payment.amount),
        },
        feeRecord: {
          ...result.feeRecord,
          amount: Number(result.feeRecord.amount),
          amountPaid: Number(result.feeRecord.amountPaid),
          amountDue: Number(result.feeRecord.amountDue),
          payments: result.feeRecord.payments?.map((p: any) => ({
            ...p,
            amount: Number(p.amount),
          })),
        },
      };

      res.status(201).json({
        success: true,
        message: 'Payment recorded successfully',
        data: formattedResult,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/fees/student/:studentId/summary - Get fee summary for a student
router.get('/student/:studentId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as any;
    const { studentId } = req.params;

    const records = await prisma.feeRecord.findMany({
      where: {
        studentId,
        instituteId: user.instituteId,
      },
      include: {
        payments: true,
      },
    });

    const summary = {
      totalDue: 0,
      totalPaid: 0,
      totalPending: 0,
      overdue: 0,
      recordCount: records.length,
    };

    const now = new Date();
    records.forEach((record: any) => {
      // Convert Decimal to number before arithmetic
      summary.totalDue += Number(record.amount);
      summary.totalPaid += Number(record.amountPaid);
      summary.totalPending += Number(record.amountDue);

      if (record.status !== 'PAID' && record.dueDate < now) {
        summary.overdue += Number(record.amountDue);
      }
    });

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
