import { Router } from 'express';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import attendanceRoutes from './attendance.routes';
import feeRoutes from './fee.routes';
import classRoutes from './class.routes';
import teacherRoutes from './teacher.routes';
import teacherAssignmentRoutes from './teacher-assignment.routes';
import teacherSubjectRoutes from './teacher-subject.routes';
import teacherScheduleRoutes from './teacher-schedule.routes';
import timetableRoutes from './timetable.routes';
import userRoutes from './user.routes';
import subjectRoutes from './subject.routes';
import dashboardRoutes from './dashboard.routes';

const router: ReturnType<typeof Router> = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/students', studentRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/fees', feeRoutes);
router.use('/classes', classRoutes);
router.use('/classes', teacherAssignmentRoutes); // Teacher assignment routes nested under classes
router.use('/timetable', timetableRoutes); // Timetable management (Class + Subject + Teacher + Time)
router.use('/classes', timetableRoutes); // Also support POST /classes/:classId/timetable
router.use('/teachers', teacherSubjectRoutes); // Teacher subject routes
router.use('/teachers', teacherScheduleRoutes); // Teacher schedule routes (GET/POST /teachers/:id/schedules)
router.use('/teachers', teacherRoutes); // Teacher CRUD routes
router.use('/schedules', teacherScheduleRoutes); // Schedule management routes (PUT/DELETE /schedules/:id)
router.use('/users', userRoutes);
router.use('/subjects', subjectRoutes);
router.use('/dashboard', dashboardRoutes); // Dashboard statistics routes

export default router;
