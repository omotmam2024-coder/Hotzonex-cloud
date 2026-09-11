# Hotzonex Cloud

A production-oriented full-stack application foundation for MikroTik hotspot management.

## Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- Redis
- Vitest

## Phase 1 Included

- Authentication scaffold (JWT-based session handling)
- Role-based access control
- Prisma schema for core business entities
- Dashboard shell
- Location management API and UI
- Router management API and UI
- MikroTik provider abstraction with mock provider
- Router testing and discovery scaffolding
- Basic audit logging

## Getting started

1. Copy `.env.example` to `.env` and update secrets.
2. Run `npm install`.
3. Run `npm run db:generate`.
4. Run `npm run db:migrate`.
5. Run `npm run dev`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test`
- `npm run db:migrate`
- `npm run db:seed`
