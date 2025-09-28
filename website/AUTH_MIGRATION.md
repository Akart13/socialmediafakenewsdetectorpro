# Auth System Consolidation

## Overview
The auth system has been consolidated to reduce duplication and improve maintainability.

## New Structure

### 1. Unified Auth Utilities (`/lib/auth-helpers.ts`)
- **`getCorsHeaders()`** - Centralized CORS configuration
- **`handleCorsOptions()`** - Handles OPTIONS requests
- **`createSessionCookie()`** - Creates session cookies with proper settings
- **`ensureUserExists()`** - Registers users in Firestore
- **`createSessionFromIdToken()`** - Creates session from ID token
- **`verifyIdTokenAndGetUser()`** - Verifies ID token and extracts user info

### 2. Session-Based Auth (`/api/auth/session`)
- **Purpose**: Creates session cookies for website users
- **Usage**: Website login flow
- **Features**: CORS support, session cookie creation

### 3. Extension Auth (`/api/ext/auth`)
- **Purpose**: Creates session cookies + registers users for extension
- **Usage**: Extension authentication flow
- **Features**: User registration, session cookies, CORS support

### 4. Unified Auth (`/api/auth/unified`)
- **Purpose**: Single endpoint for both website and extension auth
- **Usage**: `POST /api/auth/unified` with `{ idToken, registerUser: boolean }`
- **Features**: Optional user registration, session cookies

### 5. JWT Auth (`/api/auth/jwt`)
- **Purpose**: JWT-based authentication (finalize, logout, refresh)
- **Usage**: `POST /api/auth/jwt` with `{ action: 'finalize'|'logout'|'refresh', ... }`
- **Features**: Access tokens, refresh tokens, logout

## Migration Guide

### For Website Users
- **No changes needed** - existing `/api/auth/session` still works
- **Optional**: Switch to `/api/auth/unified` with `registerUser: false`

### For Extension Users
- **No changes needed** - existing `/api/ext/auth` still works
- **Optional**: Switch to `/api/auth/unified` with `registerUser: true`

### For JWT Users
- **Update calls** from individual endpoints to `/api/auth/jwt`:
  - `POST /api/auth/finalize` → `POST /api/auth/jwt` with `{ action: 'finalize', idToken }`
  - `POST /api/auth/logout` → `POST /api/auth/jwt` with `{ action: 'logout' }`
  - `POST /api/auth/refresh` → `POST /api/auth/jwt` with `{ action: 'refresh' }`

## Benefits
- **Reduced duplication** - Common logic in shared utilities
- **Consistent CORS** - All endpoints use same CORS configuration
- **Easier maintenance** - Single place to update auth logic
- **Better error handling** - Centralized error responses
- **Flexible usage** - Choose session-based or JWT-based auth

## Backward Compatibility
- **All existing endpoints still work** - no breaking changes
- **Gradual migration** - can switch to new endpoints over time
- **Same response formats** - existing clients continue to work
