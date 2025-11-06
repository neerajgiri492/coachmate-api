# CoachMate API

Backend API server for CoachMate coaching management platform.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **Authentication**: Passport.js (Local + JWT strategies)
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Validation**: Zod

## Getting Started

### Prerequisites

- Node.js 18 or higher
- pnpm 10.13.1 or higher
- PostgreSQL database

### Installation

```bash
# From the root of the monorepo
pnpm install
```

### Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update the environment variables in `.env`:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/coachmate
JWT_SECRET=your-super-secret-jwt-key
```

### Database Setup

```bash
# Generate Prisma Client
pnpm --filter @coachmate/database prisma generate

# Run migrations
pnpm --filter @coachmate/database prisma migrate dev

# (Optional) Seed database with demo data
pnpm --filter @coachmate/database prisma db seed
```

**Seed Data** includes:
- 1 Institute (Demo Coaching Institute)
- 4 Users (1 Admin, 2 Teachers, 1 Staff)
- 3 Batches (Mathematics, Science, English)
- 10 Students with realistic Indian names
- Fee records with varied statuses
- 5 days of attendance records

### Development

```bash
# Start dev server with hot reload
pnpm --filter @coachmate/api dev
```

The API will be available at `http://localhost:4000`

### Production Build

```bash
# Build the API
pnpm --filter @coachmate/api build

# Start production server
pnpm --filter @coachmate/api start
```

## API Endpoints

### Authentication

- `POST /api/v1/auth/register` - Register new institute and super admin
- `POST /api/v1/auth/login` - Login with email and password
- `POST /api/v1/auth/refresh` - Refresh access token
- `GET /api/v1/auth/me` - Get current user profile (requires auth)

### Students

- `GET /api/v1/students` - List all students (with pagination, search, filters)
- `GET /api/v1/students/:id` - Get single student details
- `POST /api/v1/students` - Create new student (Admin+)
- `PUT /api/v1/students/:id` - Update student (Admin+)
- `DELETE /api/v1/students/:id` - Delete student (Super Admin only)

### Attendance

- `GET /api/v1/attendance` - Get attendance records (with filters)
- `POST /api/v1/attendance` - Mark attendance for single student
- `POST /api/v1/attendance/bulk` - Mark attendance for multiple students
- `GET /api/v1/attendance/stats/:studentId` - Get attendance statistics

### Fees

- `GET /api/v1/fees` - List all fee records (with pagination, filters)
- `GET /api/v1/fees/:id` - Get single fee record
- `POST /api/v1/fees` - Create new fee record (Admin+)
- `POST /api/v1/fees/:id/payment` - Record payment (Admin+)
- `GET /api/v1/fees/student/:studentId/summary` - Get fee summary for student

### Batches ✨ New!

- `GET /api/v1/batches` - List all batches (with filters)
- `GET /api/v1/batches/:id` - Get batch details with students
- `POST /api/v1/batches` - Create new batch (Admin+)
- `PUT /api/v1/batches/:id` - Update batch (Admin+)
- `DELETE /api/v1/batches/:id` - Delete batch (Super Admin only)
- `POST /api/v1/batches/:id/students` - Assign students to batch (Admin+)
- `DELETE /api/v1/batches/:id/students/:studentId` - Remove student from batch (Admin+)

### Users ✨ New!

- `GET /api/v1/users` - List all users (Admin+)
- `GET /api/v1/users/:id` - Get single user details
- `POST /api/v1/users` - Create new user (Admin+)
- `PUT /api/v1/users/:id` - Update user profile
- `PATCH /api/v1/users/:id/role` - Update user role (Super Admin only)
- `PATCH /api/v1/users/:id/status` - Activate/deactivate user (Admin+)
- `PUT /api/v1/users/:id/password` - Change password (own account)
- `DELETE /api/v1/users/:id` - Delete user (Super Admin only)

### Health Check

- `GET /health` - Health check endpoint

## Authentication

The API uses JWT-based authentication. After logging in, you'll receive an access token and refresh token.

Include the access token in the Authorization header:
```
Authorization: Bearer <access_token>
```

## User Roles

- `SUPER_ADMIN` - Full access (institute owner)
- `ADMIN` - Manage students, attendance, fees
- `TEACHER` - Mark attendance, view students
- `STAFF` - Limited access

## Error Responses

All error responses follow this format:
```json
{
  "success": false,
  "message": "Error message",
  "errors": [] // Optional validation errors
}
```

## Success Responses

All success responses follow this format:
```json
{
  "success": true,
  "message": "Optional message",
  "data": {} // Response data
}
```
