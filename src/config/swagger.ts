import swaggerJsdoc from 'swagger-jsdoc';
import { version } from '../../package.json';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CoachMate API Documentation',
      version,
      description: 'Comprehensive API documentation for CoachMate - School & Coaching Management System',
      contact: {
        name: 'CoachMate Support',
        email: 'support@coachmate.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:4000/api/v1',
        description: 'Development server',
      },
      {
        url: 'https://api.coachmate.com/api/v1',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token in the format: Bearer <token>',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            phone: { type: 'string', nullable: true },
            avatar: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STAFF'] },
            employeeId: { type: 'string', nullable: true },
            joiningDate: { type: 'string', format: 'date-time', nullable: true },
            subjects: { type: 'array', items: { type: 'string' } },
            qualifications: { type: 'string', nullable: true },
            experience: { type: 'integer', nullable: true },
            specialization: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Subject: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            code: { type: 'string' },
            description: { type: 'string', nullable: true },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Student: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            rollNumber: { type: 'string', nullable: true },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email', nullable: true },
            phone: { type: 'string' },
            dateOfBirth: { type: 'string', format: 'date-time', nullable: true },
            gender: { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'], nullable: true },
            guardianName: { type: 'string' },
            guardianPhone: { type: 'string' },
            guardianEmail: { type: 'string', format: 'email', nullable: true },
            address: { type: 'string', nullable: true },
            city: { type: 'string', nullable: true },
            state: { type: 'string', nullable: true },
            pincode: { type: 'string', nullable: true },
            enrollmentDate: { type: 'string', format: 'date-time' },
            currentClass: { type: 'string', nullable: true },
            school: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
            classId: { type: 'string', format: 'uuid', nullable: true },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Class: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time', nullable: true },
            schedule: { type: 'object', nullable: true },
            capacity: { type: 'integer', nullable: true },
            isActive: { type: 'boolean' },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Attendance: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            date: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] },
            notes: { type: 'string', nullable: true },
            studentId: { type: 'string', format: 'uuid' },
            classId: { type: 'string', format: 'uuid' },
            markedBy: { type: 'string', format: 'uuid' },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        FeeRecord: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            amount: { type: 'number' },
            amountPaid: { type: 'number' },
            amountDue: { type: 'number' },
            dueDate: { type: 'string', format: 'date-time' },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            status: { type: 'string', enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] },
            feeType: { type: 'string', enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ADMISSION', 'EXAM', 'OTHER'] },
            description: { type: 'string', nullable: true },
            studentId: { type: 'string', format: 'uuid' },
            instituteId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            amount: { type: 'number' },
            paymentMethod: { type: 'string', enum: ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE'] },
            transactionId: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            paidAt: { type: 'string', format: 'date-time' },
            feeRecordId: { type: 'string', format: 'uuid' },
            receivedBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' }, nullable: true },
            stack: { type: 'string', nullable: true },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', nullable: true },
            data: { type: 'object' },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Unauthorized - Invalid or missing authentication token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Unauthorized',
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Forbidden: Insufficient permissions',
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Resource not found',
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                message: 'Validation error',
                errors: [],
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization',
      },
      {
        name: 'Subjects',
        description: 'Subject management operations',
      },
      {
        name: 'Students',
        description: 'Student management operations',
      },
      {
        name: 'Classes',
        description: 'Class management operations',
      },
      {
        name: 'Attendance',
        description: 'Attendance tracking and management',
      },
      {
        name: 'Fees',
        description: 'Fee and payment management',
      },
      {
        name: 'Users',
        description: 'User and staff management',
      },
    ],
  },
  apis: ['./src/routes/*.ts'], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options);
