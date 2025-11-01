# Installation Guide

Complete setup instructions for the Social Media Fact Checker extension and website.

## Prerequisites

Before starting, ensure you have:

- Node.js 18 or higher installed
- npm or yarn package manager
- Chrome browser (for extension testing)
- Firebase account with a project created
- Google Gemini API key

## Step 1: Firebase Setup

### Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the wizard
3. Enable Google Analytics (optional)
4. Note your project ID

### Enable Authentication

1. In Firebase Console, go to "Authentication"
2. Click "Get started"
3. Enable "Google" as a sign-in provider
4. Add your domain to authorized domains

### Enable Firestore

1. Go to "Firestore Database"
2. Click "Create database"
3. Start in production mode (we'll set rules later)
4. Choose a location for your database

### Get Service Account Key

1. Go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Download the JSON file
4. You'll need these values:
   - `project_id`
   - `client_email`
   - `private_key`

### Get Client SDK Configuration

1. Go to Project Settings → General
2. Scroll to "Your apps" section
3. Click web icon (`</>`) to add a web app
4. Register app and copy the configuration values:
   ```javascript
   {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   }
   ```

## Step 2: Firestore Security Rules

Set up Firestore security rules to deny all client access (server uses Admin SDK):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Apply these rules in Firestore Console → Rules.

## Step 3: Website Setup

### Install Dependencies

```bash
cd website
npm install
```

### Configure Environment Variables

Create `website/.env.local`:

```env
# Firebase Admin SDK (from service account JSON)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Firebase Client SDK (from web app config)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

# Google Gemini API
GEMINI_API_KEY=your-gemini-api-key

# Application Secrets
APP_JWT_SECRET=generate-a-random-secret-key-here
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Free tier daily limit (optional, defaults to 5)
FREE_DAILY_LIMIT=5
```

### Generate JWT Secret

Generate a secure random string for `APP_JWT_SECRET`:

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or using OpenSSL
openssl rand -hex 32
```

### Run Development Server

```bash
cd website
npm run dev
```

The website should now be running at `http://localhost:3000`

## Step 4: Extension Setup

### Update API URL

Edit `extension/background.js` and update the API base URL:

```javascript
const API_BASE_URL = 'http://localhost:3000'; // For local development
// Or use production URL: 'https://your-production-url.com'
```

### Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder
5. Extension icon should appear in toolbar

### Verify Extension

1. Click the extension icon
2. You should see the popup interface
3. Click "Sign In" to test authentication flow

## Step 5: Test the System

### Test Authentication

1. Click extension icon → "Sign In"
2. Should redirect to website login page
3. Sign in with Google
4. Should redirect back and show user info in popup

### Test Fact-Checking

1. Navigate to Twitter/X, Instagram, or Facebook
2. Look for "Fact Check" buttons on posts
3. Click a button and wait for analysis
4. Review results in the overlay

### Verify User Creation

1. After first sign-in, check Firestore Console
2. Navigate to `users` collection
3. Should see a document with your user ID
4. Verify `plan` field is set to `"pro"`

## Step 6: Production Deployment

### Deploy Website to Vercel

1. Push code to GitHub repository
2. Connect repository to Vercel
3. Add all environment variables in Vercel dashboard
4. Deploy

### Update Extension for Production

1. Update `API_BASE_URL` in `background.js` to production URL
2. Update CORS whitelist in website if needed
3. Test extension with production backend

### Chrome Web Store Submission

1. Zip extension folder (excluding node_modules, .git)
2. Create Chrome Web Store developer account
3. Upload zip file
4. Fill out store listing information
5. Submit for review

## Troubleshooting

### Firebase Issues

**"Permission denied" errors:**
- Verify Firestore rules deny all client access
- Ensure server is using Admin SDK (not client SDK)

**"Missing env" errors:**
- Check all environment variables are set
- Verify private key includes newlines (`\n`)

### Extension Issues

**Extension not loading:**
- Check `manifest.json` syntax
- Verify all required files are present
- Check Chrome extensions error page

**Buttons not appearing:**
- Verify you're on supported platform
- Check browser console for errors
- Refresh the page

**API connection errors:**
- Verify `API_BASE_URL` is correct
- Check backend is running and accessible
- Verify CORS is configured correctly

### Website Issues

**Authentication not working:**
- Verify Firebase configuration is correct
- Check environment variables are loaded
- Verify OAuth consent screen is configured

**API errors:**
- Check server logs in terminal
- Verify Gemini API key is valid
- Check Firebase credentials are correct

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `FIREBASE_PROJECT_ID` | Firebase project ID | `my-project-123` |
| `FIREBASE_CLIENT_EMAIL` | Service account email | `firebase-adminsdk-...@...iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Service account private key | `-----BEGIN PRIVATE KEY-----\n...` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client API key | `AIza...` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Auth domain | `my-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Project ID | `my-project-123` |
| `GEMINI_API_KEY` | Gemini API key | `AIza...` |
| `APP_JWT_SECRET` | JWT signing secret | Random 32+ character string |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Application URL | `http://localhost:3000` |
| `FREE_DAILY_LIMIT` | Daily limit for free users | `5` |

## Support

For additional help:
- Check main [README.md](README.md) for architecture overview
- See [extension/README.md](extension/README.md) for extension-specific docs
- Review code comments for implementation details