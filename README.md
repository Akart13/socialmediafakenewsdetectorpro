# Social Media Fact Checker

A comprehensive Chrome Extension (MV3) + Next.js website system that provides AI-powered fact-checking for social media posts on Twitter/X, Instagram, and Facebook.

## Architecture

This system consists of three main components:

- **Chrome Extension (MV3)**: Content script that injects fact-check buttons into social media posts, background service worker for API communication, and popup for user management
- **Next.js Website**: User authentication, billing management, and API endpoints for fact-checking and image extraction
- **Firebase & Firestore**: User authentication, session management, and user data storage

## Features

### Core Functionality

- **Multi-Platform Support**: Works seamlessly on Twitter/X, Instagram, and Facebook
- **AI-Powered Fact Checking**: Uses Google Gemini 2.5 Flash Lite for intelligent claim extraction and verification
- **Image Text Extraction**: Extracts and analyzes text from images using Gemini Vision API
- **Source Grounding**: Automatically finds and verifies sources using Google Search grounding
- **Credibility Scoring**: Provides detailed credibility ratings (1-10) for claims and overall posts
- **Interactive Results**: Beautiful overlay UI showing detailed analysis with expandable claims

### Authentication & User Management

- **Firebase Authentication**: Google OAuth sign-in integration
- **Session Management**: Secure session cookies for cross-origin requests
- **Usage Limits**: Free plan (5 fact checks per day) and Pro plan (unlimited)
- **Extension Integration**: Seamless authentication flow between extension and website

## Project Structure

```
/website                 # Next.js 14 application
  app/
    api/
      auth/             # Authentication endpoints (unified, session, jwt, refresh, logout, finalize)
      ext/              # Extension-specific endpoints
      fact-check/       # Main fact-checking API endpoint
      image-extraction/ # Image OCR and text extraction
      me/               # User information and limits endpoints
      users/            # User registration endpoint
    auth/               # Authentication page
    billing/            # Billing and plan management page
    login/              # Login page
    page.tsx            # Home/landing page
  lib/
    auth.ts             # JWT and Firebase token verification
    auth-helpers.ts     # Authentication helper functions
    auth-utils.ts       # Session cookie verification utilities
    cors.ts             # CORS wrapper for API routes
    firebaseAdmin.ts    # Firebase Admin SDK initialization
    firebaseClient.ts   # Firebase Client SDK initialization
    jwt.ts              # JWT token signing and verification

/extension              # Chrome Extension (MV3)
  background.js         # Service worker handling API calls and Prompt API bridge
  content.js            # Content script for injecting fact-check buttons and UI
  popup.js              # Popup interface for user status and statistics
  popup.html            # Popup HTML structure
  manifest.json         # Extension manifest configuration
  icons/                # Extension icons (16px, 48px, 128px)
  styles.css            # Extension styling
  README.md             # Extension-specific documentation
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Firebase project with Authentication and Firestore enabled
- Google Gemini API key
- Chrome browser for extension development

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd paymentintegration
   ```

2. **Install website dependencies**:
   ```bash
   cd website
   npm install
   ```

3. **Configure environment variables**:
   
   Create `website/.env.local` with:
   ```env
   # Firebase Admin SDK
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-client-email
   FIREBASE_PRIVATE_KEY=your-private-key
   
   # Firebase Client SDK
   NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-auth-domain
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-storage-bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
   
   # Application
   GEMINI_API_KEY=your-gemini-api-key
   APP_JWT_SECRET=your-jwt-secret
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Load the extension**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension` folder
   - Update `API_BASE_URL` in `extension/background.js` to match your deployment

5. **Run the website**:
   ```bash
   cd website
   npm run dev
   ```

## How It Works

### Fact-Checking Flow

1. **Content Script Detection**: The extension detects which platform (Twitter/Instagram/Facebook) the user is on
2. **Button Injection**: Adds "Fact Check" buttons to all visible posts using platform-specific selectors
3. **Post Extraction**: Extracts post text, images, and metadata when user clicks the button
4. **Image Processing**: Converts images to base64 and extracts text using Gemini Vision API
5. **Claim Extraction**: Uses Prompt API (LanguageModel) to identify 2-3 verifiable claims from the text
6. **Fact-Checking**: Sends claims to Gemini API with Google Search grounding to find sources and verify claims
7. **Result Display**: Shows interactive overlay with overall rating, individual claim analysis, and source citations

### Authentication Flow

1. **Extension Sign-In**: User clicks "Sign In" in extension popup
2. **Website Redirect**: Extension opens website login page
3. **Google OAuth**: User completes Google sign-in on website
4. **Session Creation**: Website creates Firebase session cookie
5. **User Registration**: New users are automatically registered in Firestore with Pro plan
6. **Extension Authentication**: Extension uses session cookies for API authentication

### API Architecture

- **Authentication**: Multiple endpoints supporting Firebase ID tokens, session cookies, and JWTs
- **Fact-Checking**: `/api/fact-check` - Main endpoint that processes text and claims
- **Image Extraction**: `/api/image-extraction` - OCR and text extraction from images
- **User Management**: `/api/me` and `/api/me/limits` - User info and usage tracking
- **CORS**: Configured to allow requests from Chrome extensions and the website domain

## Data Model

### Firestore Collections

#### users/{uid}
```json
{
  "uid": "user123",
  "email": "user@example.com",
  "plan": "pro",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### usage/{uid}_{YYYY-MM-DD}
```json
{
  "uid": "user123",
  "count": 3,
  "date": "2024-01-01",
  "updatedAt": "2024-01-01T12:00:00Z"
}
```

## Usage Limits

- **Free Plan**: 5 fact checks per day (resets at midnight UTC)
- **Pro Plan**: Unlimited fact checks (all new users default to Pro)
- Usage is tracked per day in Firestore `usage` collection
- Extension popup displays remaining checks for free users

## Security Features

- **Firestore Security**: All client access denied; server uses Firebase Admin SDK only
- **CORS Protection**: Strict CORS configuration for extension and website domains
- **Session Cookies**: HttpOnly, Secure cookies for cross-origin requests
- **Token Expiration**: JWT tokens expire after 24 hours; session cookies after 14 days
- **Input Validation**: All API inputs are validated and sanitized
- **Quota Enforcement**: Server-side quota checking prevents abuse

## Development

### Extension Development

The extension consists of three main parts:
- **Content Script** (`content.js`): Detects platform, injects buttons, extracts post data, displays results
- **Background Service Worker** (`background.js`): Handles API calls, image fetching, Prompt API bridge
- **Popup** (`popup.js`): Shows user status, statistics, and sign-in/upgrade options

### Website Development

Built with Next.js 14 App Router:
- API routes in `app/api/` directory
- Server components and client components separated
- TypeScript for type safety
- Firebase Admin SDK for server-side operations

### Testing

1. **Authentication**: Test extension login → website OAuth → session creation
2. **Fact-Checking**: Verify claim extraction, source finding, and result display
3. **Image Extraction**: Test OCR functionality with various image types
4. **Quota Limits**: Verify free user limits and Pro user unlimited access

## Deployment

### Website Deployment (Vercel)

1. Connect GitHub repository to Vercel
2. Configure all environment variables in Vercel dashboard
3. Deploy automatically on push to main branch
4. Update extension `API_BASE_URL` to production URL

### Extension Deployment

1. Build and test extension locally
2. Create Chrome Web Store developer account
3. Zip extension files (excluding node_modules, .git)
4. Submit to Chrome Web Store for review

## Troubleshooting

### Extension Issues

- **Buttons not appearing**: Check browser console, verify platform detection, refresh page
- **Authentication fails**: Verify API_BASE_URL, check session cookies are enabled
- **API errors**: Check network tab, verify API endpoint is accessible

### Website Issues

- **Authentication errors**: Verify Firebase configuration and environment variables
- **API 500 errors**: Check server logs, verify Gemini API key and Firebase credentials
- **CORS errors**: Verify origin is whitelisted in CORS configuration

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

For detailed setup instructions, see [install.md](install.md).
For extension-specific documentation, see [extension/README.md](extension/README.md).