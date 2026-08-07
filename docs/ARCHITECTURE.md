# Architecture

## System Overview

```
┌─────────────┐        ┌─────────────┐        ┌─────────────┐
│  Mini App   │        │  Admin UI   │        │  External   │
│  (React)    │────────│  (React)    │────────│  Clients    │
└─────────────┘        └─────────────┘        └─────────────┘
        │                      │                      │
        └──────────────────────┴──────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │
                    │  (CORS, Auth)     │
                    └─────────┬─────────┘
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
    ┌────▼───────┐                         ┌──────▼──────┐
    │   FastAPI   │                         │   WebSocket │
    │   Backend   │────────────────────────│   Server    │
    │             │                         │  (Real-time)│
    └────┬───────┘                         └─────────────┘
         │
    ┌────▼───────────────────────┐
    │  Business Logic Layer       │
    │  ├─ Services               │
    │  ├─ Models                 │
    │  ├─ Validators             │
    │  └─ Middleware             │
    └────┬───────────────────────┘
         │
    ┌────▼───────────────────────┐
    │  Data Access Layer          │
    │  ├─ SQLAlchemy ORM         │
    │  ├─ Migrations (Alembic)   │
    │  └─ Queries                │
    └────┬───────────────────────┘
         │
    ┌────▼───────────────────────┐
    │  PostgreSQL Database        │
    │  ├─ Users                  │
    │  ├─ Features               │
    │  ├─ Plans                  │
    │  └─ Audit Logs             │
    └─────────────────────────────┘
```

## Backend Architecture

### Layers

#### 1. API Layer (`app/api/`)
- HTTP endpoints definition
- Request validation (Pydantic schemas)
- Response formatting
- Route grouping by domain

```
app/api/
├── routes/
│   ├── auth.py       # Authentication endpoints
│   ├── products.py   # Product features
│   ├── plans.py      # Tariff plans
│   └── audit.py      # Audit logs
└── dependencies.py   # Dependency injection
```

#### 2. Business Logic Layer (`app/services/`)
- Core business logic
- Data validation and transformation
- Authorization checks
- Transaction management

```
app/services/
├── auth_service.py
├── product_service.py
├── plan_service.py
├── audit_service.py
└── base_service.py
```

#### 3. Data Access Layer (`app/models/`)
- SQLAlchemy ORM models
- Database schema definition
- Relationships between tables
- Query methods

```
app/models/
├── user.py
├── product_feature.py
├── plan.py
├── audit_log.py
└── base.py
```

#### 4. Middleware & Utils
- JWT authentication middleware
- Logging middleware
- Error handling
- Utility functions

### Request Flow

1. **Request arrives** → API Gateway (CORS, rate limiting)
2. **Authentication** → JWT middleware validates token
3. **Route handler** → API endpoint processes request
4. **Validation** → Pydantic schema validates input
5. **Business logic** → Service layer executes business rules
6. **Data access** → ORM interacts with database
7. **Response** → Formatted JSON response sent back

## Frontend Architecture

### Structure

```
src/
├── components/       # Reusable UI components
│   ├── Layout/
│   ├── Header/
│   ├── Sidebar/
│   └── Common/
├── pages/            # Page components (routes)
│   ├── Dashboard/
│   ├── Products/
│   ├── Plans/
│   └── Admin/
├── services/         # API services
│   ├── api.ts        # Axios instance
│   ├── auth.ts
│   └── products.ts
├── store/            # State management (Zustand/Context)
├── hooks/            # Custom React hooks
├── types/            # TypeScript types
├── utils/            # Utilities
└── styles/           # Global styles (TailwindCSS)
```

### State Management

Using **Zustand** for simple state management:
- User authentication state
- Current user data
- UI state (modals, notifications)

```typescript
// Example store
import create from 'zustand'

interface AuthStore {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthStore>(...)
```

### API Communication

Using **Axios** with interceptors:
- Automatic JWT token injection
- Error handling
- Request/response logging
- Retry logic

## Database Design

### Key Principles

1. **UUID Primary Keys** - All tables use UUID for distributed IDs
2. **Soft deletes** - Not used; archival through status fields
3. **Audit trail** - All changes logged in audit_logs
4. **Timestamps** - created_at, updated_at in UTC
5. **Indexing** - Foreign keys and frequently searched fields indexed

### Schema Overview

```
Users (1) ─── (N) Audit Logs
  │
  ├─ Roles: User, Content Manager, Admin
  ├─ Status: active, inactive
  └─ Timezone for display/calculation

Product Features (N) ─── (M) Plans
  ├─ Features: alpha, beta, production
  ├─ Plans: free, pro, enterprise
  └─ Relationships: plans contain sets of features

Audit Logs
  ├─ Tracks all admin actions
  ├─ Records before/after state
  └─ Links to users and entities
```

## Security Architecture

### Authentication Flow

```
Client sends credentials
        │
        ▼
Backend validates credentials
        │
        ▼
Generates JWT token
        │
        ▼
Returns token to client
        │
        ▼
Client stores token (localStorage/sessionStorage)
        │
        ▼
Client includes in Authorization header for subsequent requests
```

### Authorization

- **Role-based access control (RBAC)**
- User can only access/modify their own data
- Admin/Content Manager have elevated permissions
- Row-level security enforced at database level

### Data Protection

- Passwords hashed with bcrypt
- JWT tokens with expiration
- HTTPS in production
- SQL injection prevention (ORM)
- CSRF protection

## Deployment Architecture

### Production Environment

```
┌─────────────────────────────────┐
│    Nginx / Load Balancer        │
└────────────────┬────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼──┐  ┌──────▼──┐  ┌─────▼──┐
│App 1 │  │ App 2  │  │ App 3  │
└───┬──┘  └──────┬──┘  └──────┬─┘
    │            │            │
    └────────────┼────────────┘
                 │
        ┌────────▼────────┐
        │  PostgreSQL DB  │
        │  (Primary)      │
        └─────────────────┘
```

### Docker Containers

- Backend container (Python FastAPI)
- Frontend container (React/Nginx)
- PostgreSQL container
- Redis container (for caching, optional)

---

**Version**: 1.0.0  
**Last Updated**: 2026-07-26
