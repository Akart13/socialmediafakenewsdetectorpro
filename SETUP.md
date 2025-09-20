# Social Media Fact Checker - Setup Guide

This guide will help you set up the complete Social Media Fact Checker system with Chrome extension, Next.js website, and Express backend.

## Project Structure

```
/website               # Next.js 14 app
  app/
    auth.tsx           # client-only Firebase login page
    billing.tsx        # starts Stripe Checkout
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

## 1. Firebase Setup

### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Authentication (Google provider)
4. Enable Firestore in Native mode

### Configure Authentication
1. In Firebase Console → Authentication → Sign-in method
2. Enable Google provider
3. Add authorized domains:
   - `localhost` (for development)
   - Your production domain (e.g., `your-site.vercel.app`)
   - Any custom domains

### Get Firebase Config
1. Go to Project Settings → General → Your apps
2. Add a web app
3. Copy the Firebase config values

### Generate Service Account
1. Go to Project Settings → Service accounts
2. Click "Generate new private key"
3. Save the JSON file as `service-account.json` in the `/api` directory

### Set Firestore Rules
Deploy the rules from `firestore.rules`:
```bash
firebase deploy --only firestore:rules
```

## 2. Stripe Setup

### Create Stripe Account
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Create a new product called "Pro Plan"
3. Set up a recurring price (e.g., $9.99/month)
4. Copy the price ID (starts with `price_`)

### Set up Webhooks
1. Go to Developers → Webhooks
2. Add endpoint: `https://your-api-domain.com/api/billing/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the webhook secret (starts with `whsec_`)

## 3. Environment Configuration

### API Environment Variables
Create `/api/.env`:
```env
PORT=8080
APP_JWT_SECRET=your-very-strong-secret-here
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
STRIPE_SECRET=sk_test_your_stripe_secret_key
STRIPE_PRICE_PRO=price_your_pro_price_id
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
FREE_DAILY_LIMIT=5
CORS_ALLOW=chrome-extension://your-dev-extension-id,chrome-extension://your-store-extension-id,https://your-site-domain.com,http://localhost:3000
```

### Website Environment Variables
Create `/website/.env.local`:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-firebase-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
NEXT_PUBLIC_SITE_DOMAIN=https://your-site-domain.com
NEXT_PUBLIC_API_URL=https://your-api-domain.com
```

### Extension Configuration
Update `/extension/src/popup.ts`:
```typescript
// Replace these with your actual domains
this.apiDomain = 'https://your-api-domain.com';
this.siteDomain = 'https://your-site-domain.com';
```

## 4. Installation & Development

### Install Dependencies
```bash
# Extension
cd extension
npm install
npm run build

# Website
cd ../website
npm install

# API
cd ../api
npm install
```

### Development
```bash
# Terminal 1 - API Server
cd api
npm run dev

# Terminal 2 - Website
cd website
npm run dev

# Terminal 3 - Extension (watch mode)
cd extension
npm run dev
```

## 5. Chrome Extension Setup

### Load Extension in Chrome
1. Open Chrome → Extensions → Developer mode
2. Click "Load unpacked"
3. Select the `/extension` folder
4. Copy the extension ID from the extensions page

### Update CORS Configuration
Update the `CORS_ALLOW` environment variable with your extension IDs:
```env
CORS_ALLOW=chrome-extension://your-dev-extension-id,chrome-extension://your-store-extension-id,https://your-site-domain.com,http://localhost:3000
```

## 6. Deployment

### Deploy API (Vercel/Render/GCR)
1. Build the API: `cd api && npm run build`
2. Deploy with environment variables configured

### Deploy Website (Vercel)
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push

### Deploy Extension
1. Build extension: `cd extension && npm run build`
2. Zip the extension folder contents
3. Submit to Chrome Web Store

## 7. Testing the Flow

### Test Authentication Flow
1. Open extension popup
2. Click "Sign in"
3. Complete Google OAuth on website
4. Verify extension shows authenticated state

### Test Fact Checking
1. Enter some text in extension popup
2. Click "Fact check"
3. Verify API call succeeds and usage increments

### Test Upgrade Flow
1. Click "Upgrade to Pro" in extension
2. Complete Stripe checkout on website
3. Verify extension polls and updates to Pro status

## 8. Data Model

### Firestore Collections

#### users/{uid}
```json
{
  "plan": "free" | "pro",
  "stripeCustomerId": "cus_...",
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

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure all domains are in `CORS_ALLOW`
2. **Authentication Fails**: Check Firebase config and authorized domains
3. **Stripe Webhooks**: Verify webhook URL and secret
4. **Extension Permissions**: Ensure manifest.json has correct permissions

### Debug Mode
- API: Check server logs for detailed error messages
- Website: Use browser dev tools
- Extension: Use Chrome extension dev tools

## Security Notes

- Firestore rules deny all client access
- All data operations use Firebase Admin SDK
- JWT tokens expire after 24 hours
- Stripe webhooks are verified with signatures
- CORS is strictly configured
