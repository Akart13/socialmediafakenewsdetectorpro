# Debug User Registration

## Issue Fixed
The extension login flow was not creating user documents in Firestore because the `/login` page only called `/api/auth/session` but not `/api/users/register`.

## What Was Fixed
Updated `/app/login/page.tsx` to call `/api/users/register` before creating the session cookie.

## Flow Now
1. Extension opens `/login?from=extension`
2. User signs in with Google
3. **`onAuthStateChanged` fires**
4. **Calls `/api/users/register`** to create user document in Firestore
5. **Calls `/api/auth/session`** to create session cookie
6. Tab closes for extension users

## Testing
To verify the fix works:

1. **Open extension popup**
2. **Click "Sign In"** button
3. **Sign in with Google** on the login page
4. **Check Firestore console** - should see user document created in `users/{uid}` collection

## User Document Format
```javascript
{
  uid: "firebase-uid",
  email: "user@example.com", 
  plan: "free",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z"
}
```

## Debugging
If user documents are still not being created:

1. **Check browser console** for registration logs
2. **Check server logs** for `/api/users/register` calls
3. **Verify Firebase Admin SDK** is properly configured
4. **Check Firestore rules** allow writes to `users` collection

## Related Files
- `/app/login/page.tsx` - Now calls user registration
- `/app/auth/page.tsx` - Already had user registration
- `/api/users/register/route.ts` - Creates user documents
- `/api/ext/auth/route.ts` - Also calls user registration
