import { Router, Request, Response } from 'express';
import { prisma } from '@coachmate/database';
import { authorize, authenticate } from '../middleware/auth';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/v1/dashboard/stats
 * Get comprehensive dashboard statistics
 * Returns: total students, classes, attendance percentage, fees collected
 */
router.get('/stats', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const instituteId = (req.user as any).instituteId;

    // Get total students count
    const totalStudents = await prisma.student.count({
      where: { instituteId }
    });

    // Get total classes count
    const totalClasses = await prisma.class.count({
      where: { instituteId }
    });

    // Get today's attendance stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await prisma.attendance.findMany({
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow
        },
        class: {
          instituteId
        }
      }
    });

    const presentCount = todayAttendance.filter(a => a.status === 'PRESENT').length;
    const attendancePercentage = todayAttendance.length > 0
      ? Math.round((presentCount / todayAttendance.length) * 100)
      : 0;

    // Get total fees collected
    const feeRecords = await prisma.feeRecord.findMany({
      where: {
        instituteId
      }
    });

    const totalFeesCollected = feeRecords.reduce((sum: number, record: any): number => {
      return sum + Number(record.amountPaid || 0);
    }, 0);

    // Get pending fees (overdue)
    const pendingFees = feeRecords.filter((fee: any) => {
      const amountNum = Number(fee.amount);
      const amountPaidNum = Number(fee.amountPaid);
      const status = amountNum === amountPaidNum ? 'PAID'
        : amountPaidNum === 0 ? 'PENDING'
        : 'PARTIAL';

      const dueDate = new Date(fee.dueDate);
      const isOverdue = dueDate < today && status !== 'PAID';

      return isOverdue;
    }).length;

    // Get total teachers count
    const totalTeachers = await prisma.user.count({
      where: {
        instituteId,
        role: 'TEACHER'
      }
    });

    // Get class breakdown by subject from timetable
    const classSubjectStats = await prisma.timetable.groupBy({
      by: ['subjectId'],
      where: {
        class: {
          instituteId
        }
      },
      _count: {
        classId: true
      }
    });

    // Get active classes (with students)
    const activeClasses = await prisma.class.findMany({
      where: {
        instituteId,
        isActive: true
      },
      include: {
        _count: {
          select: {
            students: true
          }
        }
      }
    });

    const classesWithStudents = activeClasses.filter(c => c._count.students > 0).length;

    res.json({
      success: true,
      data: {
        stats: {
          totalStudents,
          totalClasses,
          totalTeachers,
          classesWithStudents,
          attendanceToday: {
            percentage: attendancePercentage,
            presentCount,
            totalRecords: todayAttendance.length
          },
          feesCollected: {
            total: totalFeesCollected,
            formattedTotal: new Intl.NumberFormat('en-IN', {
              style: 'currency',
              currency: 'INR'
            }).format(totalFeesCollected),
            pendingOverdue: pendingFees
          },
          subjectStats: classSubjectStats.map(stat => ({
            subjectId: stat.subjectId,
            classCount: stat._count.classId
          }))
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/dashboard/stats/attendance-by-class
 * Get attendance statistics broken down by class
 */
router.get('/stats/attendance-by-class', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const instituteId = (req.user as any).instituteId;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 7));
    const end = endDate ? new Date(endDate as string) : new Date();

    const attendanceByClass = await prisma.class.findMany({
      where: {
        instituteId,
        isActive: true
      },
      include: {
        attendance: {
          where: {
            createdAt: {
              gte: start,
              lte: end
            }
          }
        },
        students: true
      }
    });

    const classStats = attendanceByClass.map((cls: any) => {
      const totalRecords = cls.attendance.length;
      const presentCount = cls.attendance.filter((a: any) => a.status === 'PRESENT').length;
      const absentCount = cls.attendance.filter((a: any) => a.status === 'ABSENT').length;
      const lateCount = cls.attendance.filter((a: any) => a.status === 'LATE').length;
      const excusedCount = cls.attendance.filter((a: any) => a.status === 'EXCUSED').length;

      return {
        classId: cls.id,
        className: cls.name,
        studentCount: cls.students.length,
        totalRecords,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        excused: excusedCount,
        presentPercentage: totalRecords > 0 ? Math.round((presentCount / totalRecords) * 100) : 0
      };
    });

    res.json({
      success: true,
      data: {
        period: {
          startDate: start,
          endDate: end
        },
        classStats
      }
    });
  } catch (error: any) {
    console.error('Error fetching attendance by class:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/dashboard/stats/fees-by-class
 * Get fees collection statistics broken down by class
 */
router.get('/stats/fees-by-class', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const instituteId = (req.user as any).instituteId;

    const classes = await prisma.class.findMany({
      where: {
        instituteId,
        isActive: true
      },
      include: {
        students: {
          include: {
            feeRecords: true
          }
        }
      }
    });

    const feeStats = classes.map((cls: any) => {
      const classFees = cls.students.flatMap((s: any) => s.feeRecords);
      const totalAmount = classFees.reduce((sum: number, f: any): number => sum + Number(f.amount), 0);
      const totalCollected = classFees.reduce((sum: number, f: any): number => sum + Number(f.amountPaid), 0);
      const pendingAmount = totalAmount - totalCollected;

      const paidCount = classFees.filter((f: any) => f.amount === f.amountPaid).length;
      const partialCount = classFees.filter((f: any) => f.amountPaid > 0 && f.amount !== f.amountPaid).length;
      const pendingCount = classFees.filter((f: any) => f.amountPaid === 0).length;

      return {
        classId: cls.id,
        className: cls.name,
        studentCount: cls.students.length,
        totalFees: totalAmount,
        totalCollected,
        pendingAmount,
        collectionPercentage: totalAmount > 0 ? Math.round((totalCollected / totalAmount) * 100) : 0,
        status: {
          paid: paidCount,
          partial: partialCount,
          pending: pendingCount
        }
      };
    });

    const totals = {
      totalFees: feeStats.reduce((sum: number, f: any): number => sum + f.totalFees, 0),
      totalCollected: feeStats.reduce((sum: number, f: any): number => sum + f.totalCollected, 0),
      pendingAmount: feeStats.reduce((sum: number, f: any): number => sum + f.pendingAmount, 0)
    };

    res.json({
      success: true,
      data: {
        totals,
        classStats: feeStats
      }
    });
  } catch (error: any) {
    console.error('Error fetching fees by class:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fees statistics',
      error: error.message
    });
  }
});

/**
 * GET /api/v1/dashboard/stats/students-by-class
 * Get student distribution across classes
 */
router.get('/stats/students-by-class', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const instituteId = (req.user as any).instituteId;

    const classes = await prisma.class.findMany({
      where: {
        instituteId,
        isActive: true
      },
      include: {
        students: true,
        timetables: {
          include: {
            subject: {
              select: {
                name: true
              }
            }
          },
          distinct: ['subjectId']
        }
      }
    });

    const studentStats = classes.map((cls: any) => ({
      classId: cls.id,
      className: cls.name,
      studentCount: cls.students.length,
      capacity: cls.capacity || 0,
      utilizationPercentage: cls.capacity ? Math.round((cls.students.length / cls.capacity) * 100) : 0,
      subjects: cls.timetables.map((t: any) => t.subject.name).join(', ')
    }));

    const totals = {
      totalClasses: classes.length,
      totalStudents: classes.reduce((sum: number, c: any): number => sum + c.students.length, 0),
      totalCapacity: classes.reduce((sum: number, c: any): number => sum + (c.capacity || 0), 0)
    };

    res.json({
      success: true,
      data: {
        totals,
        classStats: studentStats
      }
    });
  } catch (error: any) {
    console.error('Error fetching students by class:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student distribution',
      error: error.message
    });
  }
});

export default router;
