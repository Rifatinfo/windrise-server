# Windrise Server

Production-ready REST API backend for Windrise built with Node.js, Express.js, TypeScript, Prisma ORM, and PostgreSQL.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL (Neon)
- **Auth:** JWT (Access + Refresh tokens)
- **Validation:** Zod
- **File Upload:** Multer + Cloudinary
- **Email:** Nodemailer
- **Security:** Helmet, CORS, Rate Limiting

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your values

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start development server
npm run dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build TypeScript |
| `npm start` | Start production server |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run migrations (dev) |
| `npm run prisma:migrate:prod` | Run migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio |

## API Endpoints

### Auth
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh-token` - Refresh access token
- `POST /api/v1/auth/change-password` - Change password (auth required)
- `GET /api/v1/auth/me` - Get current user (auth required)

### Users
- `GET /api/v1/users` - Get all users (admin)
- `GET /api/v1/users/:id` - Get user by ID (auth required)
- `PATCH /api/v1/users/:id` - Update user (auth required)
- `DELETE /api/v1/users/:id` - Delete user (admin)

### Posts
- `GET /api/v1/posts` - Get all posts
- `GET /api/v1/posts/:id` - Get post by ID
- `POST /api/v1/posts` - Create post (auth required)
- `PATCH /api/v1/posts/:id` - Update post (auth required)
- `DELETE /api/v1/posts/:id` - Delete post (auth required)

## Project Structure

```
windrise-server/
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   ├── enums.prisma
│   └── prisma.config.ts
├── src/
│   ├── app/
│   │   ├── modules/        # Feature modules
│   │   ├── middlewares/     # Express middlewares
│   │   ├── errors/         # Error handling
│   │   ├── helpers/        # Utility helpers
│   │   ├── interfaces/     # TypeScript interfaces
│   │   ├── types/          # TypeScript types
│   │   ├── validators/     # Zod validation schemas
│   │   ├── constants/      # App constants
│   │   ├── config/         # Configuration files
│   │   └── routes/         # API routes
│   ├── shared/             # Shared utilities
│   ├── config/             # Global config
│   ├── app.ts              # Express app setup
│   └── server.ts           # Server entry point
├── .env
├── package.json
├── tsconfig.json
└── vercel.json
```

## License

MIT
