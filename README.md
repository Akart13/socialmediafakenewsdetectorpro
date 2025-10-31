# Social Media Fact Checker

A comprehensive Chrome MV3 extension + website + backend system that provides AI-powered fact-checking for social media posts.

## Architecture

This system consists of three main components:

- **Chrome Extension (MV3)**: Popup UI for fact-checking with authentication
- **Next.js Website**: User authentication and billing management
- **Express Backend**: API server with JWT auth and usage limits

## Features

- **Unlimited Fact Checks**: All users have Pro access with unlimited fact checks
- **Chrome Extension Integration**: Seamless auth flow using `chrome.identity.launchWebAuthFlow`
- **Firebase Authentication**: Google OAuth integration

## Quick Start

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd paymentintegration
   ```

2. **Follow the setup guide**:
   See [SETUP.md](SETUP.md) for detailed configuration instructions.

3. **Configure environment variables**:
   - Set up Firebase project and get service account
   - Update domain configurations in all components

4. **Install and run**:
   ```bash
   # Extension
   cd extension && npm install && npm run build
   
   # Website
   cd ../website && npm install && npm run dev
   
   # API
   cd ../api && npm install && npm run dev
   ```

## Project Structure

```
/website               # Next.js 14 app
  app/
    auth.tsx           # client-only Firebase login page
    billing.tsx        # plan information page
    ext/login.ts       # server route: handles extension login flow
  lib/
    firebaseClient.ts  # client SDK init
/api                   # Express server
  src/
    server.ts
    jwt.ts             # sign/verify app JWT
/extension
  src/
    popup.ts           # Extension popup implementation
  popup.js             # Built from TypeScript
  manifest.json
  popup.html
```

## Authentication Flow

1. User clicks "Sign in" in extension popup
2. Extension opens website login page via `chrome.identity.launchWebAuthFlow`
3. User completes Google OAuth on website
4. Website redirects back to extension with JWT token in URL hash
5. Extension stores token and uses it for API calls

## Usage Limits

- **Pro Plan**: All users have unlimited fact checks
- Extension polls `/api/me/limits` to display current usage

## Data Model

### Firestore Collections

#### users/{uid}
```json
{
  "plan": "pro",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### usage/{uid}_{YYYY-MM-DD}
```json
{
  "uid": "user123",
  "day": "2024-01-01",
  "count": 3,
  "updatedAt": "2024-01-01T12:00:00Z"
}
```

## Security

- Firestore rules deny all client access
- Server uses Firebase Admin SDK for all operations
- JWT tokens expire after 24 hours
- CORS strictly configured for extension and website domains

## Development

### Extension Development
```bash
cd extension
npm run dev  # Watch mode for TypeScript compilation
```

### Website Development
```bash
cd website
npm run dev  # Next.js development server
```

### API Development
```bash
cd api
npm run dev  # Express server with hot reload
```

## Deployment

- **Extension**: Build and submit to Chrome Web Store
- **Website**: Deploy to Vercel with environment variables
- **API**: Deploy to Vercel/Render/GCR with environment variables

## Testing

1. **Authentication Flow**: Test extension login → website OAuth → extension auth
2. **Fact Checking**: Verify unlimited Pro access for all users

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

For setup help, see [SETUP.md](SETUP.md) for detailed configuration instructions.