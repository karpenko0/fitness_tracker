# API Documentation

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

Все эндпоинты (кроме публичных) требуют JWT Bearer Token:

```
Authorization: Bearer <access_token>
```

## Response Format

### Success Response

```json
{
  "status": "success",
  "data": {
    // response data
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "traceId": "unique-trace-id"
  }
}
```

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid data |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - No permission for this action |
| 404 | Not Found - Resource not found or not accessible |
| 409 | Conflict - Version mismatch or state conflict |
| 422 | Unprocessable Entity - Business rule violation |
| 500 | Internal Server Error |

## Endpoints

### Public Endpoints

#### GET /product/config
Get public product configuration.

**Response:**
```json
{
  "status": "success",
  "data": {
    "features": [...],
    "plans": [...],
    "version": "1.0.0"
  }
}
```

### Authentication Endpoints

#### POST /auth/login
Login with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "access_token": "token...",
    "token_type": "bearer",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

#### POST /auth/signup
Register new user.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "first_name": "John",
  "last_name": "Doe"
}
```

#### GET /auth/me
Get current user info.

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "user",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### Product Features Endpoints

#### GET /products/features
List all features (paginated).

**Query Parameters:**
- `page` (int, default=1)
- `pageSize` (int, default=20, max=100)

**Response:**
```json
{
  "status": "success",
  "data": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "items": [...]
  }
}
```

#### GET /products/features/{id}
Get specific feature.

#### POST /products/features
Create new feature (admin only).

**Request Headers:**
```
Idempotency-Key: <uuid>
```

#### PATCH /products/features/{id}
Update feature (admin only).

**Request Headers:**
```
Idempotency-Key: <uuid>
```

### Plans Endpoints

#### GET /plans
List all plans.

#### GET /plans/{id}
Get specific plan.

#### POST /plans
Create new plan (admin only).

#### PATCH /plans/{id}
Update plan (admin only).

### Audit Logs Endpoints (Admin only)

#### GET /audit/logs
List audit logs.

**Query Parameters:**
- `page` (int, default=1)
- `pageSize` (int, default=20, max=100)
- `userId` (uuid, optional)
- `action` (string, optional)

## Pagination

All list endpoints return paginated results:

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 100,
  "items": [...]
}
```

## Error Codes

| Code | Description |
|------|-------------|
| UNAUTHORIZED | User not authenticated |
| FORBIDDEN | User doesn't have permission |
| NOT_FOUND | Resource not found |
| INVALID_DATA | Request data is invalid |
| CONFLICT | Version mismatch or state conflict |
| BUSINESS_RULE_VIOLATION | Business rule not satisfied |
| INTERNAL_ERROR | Server error |

## Rate Limiting

Rate limiting applies to all endpoints:
- 100 requests per 60 seconds per IP

## Headers

Common headers:

```
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid> (for mutating requests)
X-Request-ID: <uuid> (optional, for tracing)
```

## Swagger UI

Interactive API documentation available at:
```
http://localhost:8000/docs
```

---

**Version**: 1.0.0
