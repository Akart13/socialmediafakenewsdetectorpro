# Deployment Guide

This guide covers deploying all three components of the Social Media Fact Checker system.

## Prerequisites

1. Complete the setup from [SETUP.md](SETUP.md)
2. Have your Firebase project configured
3. Have your Stripe account set up with products and webhooks
4. Have your domains ready (website domain and API domain)

## 1. Deploy the API Backend

### Option A: Vercel (Recommended)

1. **Connect to Vercel**:
   ```bash
   cd api
   npm install -g vercel
   vercel login
   vercel
   ```

2. **Set Environment Variables**:
   In Vercel dashboard → Project Settings → Environment Variables:
   ```
   PORT=8080
   APP_JWT_SECRET=your-strong-jwt-secret
   FIREBASE_PROJECT_ID=your-firebase-project-id
   STRIPE_SECRET=sk_live_your_stripe_secret
   STRIPE_PRICE_PRO=price_your_pro_price_id
   STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
   FREE_DAILY_LIMIT=5
   CORS_ALLOW=chrome-extension://your-dev-extension-id,chrome-extension://your-store-extension-id,https://your-site-domain.com
   ```

3. **Upload Service Account**:
   - In Vercel dashboard → Project Settings → Environment Variables
   - Add `GOOGLE_APPLICATION_CREDENTIALS` with the entire service account JSON as the value
   - Or use Firebase Admin SDK auto-initialization in production

### Option B: Render

1. **Create Web Service**:
   - Connect your GitHub repository
   - Set build command: `npm run build`
   - Set start command: `npm start`
   - Set root directory: `api`

2. **Set Environment Variables**:
   Same as Vercel above

### Option C: Google Cloud Run

1. **Build and Deploy**:
   ```bash
   cd api
   gcloud builds submit --tag gcr.io/your-project/fact-checker-api
   gcloud run deploy fact-checker-api --image gcr.io/your-project/fact-checker-api --platform managed --region us-central1 --allow-unauthenticated
   ```

2. **Set Environment Variables**:
   ```bash
   gcloud run services update fact-checker-api --set-env-vars="PORT=8080,APP_JWT_SECRET=your-secret,..."
   ```

## 2. Deploy the Website

### Vercel (Recommended)

1. **Connect to Vercel**:
   ```bash
   cd website
   vercel
   ```

2. **Set Environment Variables**:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-firebase-project-id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
   NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
   NEXT_PUBLIC_SITE_DOMAIN=https://your-site-domain.com
   NEXT_PUBLIC_API_URL=https://your-api-domain.com
   ```

3. **Custom Domain** (Optional):
   - Add custom domain in Vercel dashboard
   - Update Firebase authorized domains
   - Update CORS_ALLOW in API environment variables

## 3. Deploy the Chrome Extension

### Development Testing

1. **Build Extension**:
   ```bash
   cd extension
   npm run build
   ```

2. **Load in Chrome**:
   - Open Chrome → Extensions → Developer mode
   - Click "Load unpacked"
   - Select the `extension` folder
   - Copy the extension ID

3. **Update CORS**:
   Update API `CORS_ALLOW` with your development extension ID:
   ```
   CORS_ALLOW=chrome-extension://your-dev-extension-id,chrome-extension://your-store-extension-id,https://your-site-domain.com
   ```

### Chrome Web Store

1. **Prepare for Submission**:
   ```bash
   cd extension
   npm run build
   # Zip the contents of the extension folder (not the folder itself)
   ```

2. **Update Configuration**:
   - Update `src/popup.ts` with production domains
   - Rebuild: `npm run build`
   - Update `manifest.json` with store extension ID placeholder

3. **Submit to Chrome Web Store**:
   - Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   - Upload the extension zip file
   - Fill in store listing information
   - Submit for review

4. **Update CORS After Approval**:
   Once approved, get your store extension ID and update API `CORS_ALLOW`:
   ```
   CORS_ALLOW=chrome-extension://your-dev-extension-id,chrome-extension://your-store-extension-id,https://your-site-domain.com
   ```

## 4. Update Configuration

After deployment, update these configuration files:

### Extension Configuration
Update `/extension/src/popup.ts`:
```typescript
this.apiDomain = 'https://your-api-domain.com';
this.siteDomain = 'https://your-site-domain.com';
```

### Firebase Authorized Domains
Add your production domains to Firebase Console → Authentication → Settings → Authorized domains:
- `your-site-domain.com`
- `your-api-domain.com` (if different)

### Stripe Webhook URL
Update Stripe webhook endpoint to:
```
https://your-api-domain.com/api/billing/webhook
```

## 5. Testing Deployment

### Test Authentication Flow
1. Open deployed extension
2. Click "Sign in"
3. Complete OAuth on website
4. Verify extension shows authenticated state

### Test Fact Checking
1. Enter text in extension
2. Click "Fact check"
3. Verify API call succeeds

### Test Billing
1. Click "Upgrade to Pro"
2. Complete Stripe checkout
3. Verify extension updates to Pro status

### Test Limits
1. Make 5 fact checks as free user
2. Verify 6th check returns quota exceeded
3. Upgrade to Pro
4. Verify unlimited access

## 6. Monitoring

### API Monitoring
- Check Vercel/Render/GCR logs for errors
- Monitor Stripe webhook delivery
- Check Firebase usage and quotas

### Extension Monitoring
- Monitor Chrome Web Store reviews
- Check for extension crashes in Chrome
- Monitor API call success rates

### Website Monitoring
- Check Vercel analytics
- Monitor Firebase Auth usage
- Check for JavaScript errors

## 7. Maintenance

### Regular Updates
- Keep dependencies updated
- Monitor for security vulnerabilities
- Update Firebase and Stripe SDKs

### Scaling Considerations
- Monitor API response times
- Consider caching for fact-check results
- Monitor Firestore usage and costs
- Consider rate limiting for API endpoints

## Troubleshooting

### Common Deployment Issues

1. **CORS Errors**: Ensure all domains are in CORS_ALLOW
2. **Authentication Fails**: Check Firebase config and authorized domains
3. **Stripe Webhooks**: Verify webhook URL and secret
4. **Extension Loading**: Check manifest.json and permissions

### Debug Commands
```bash
# Check API health
curl https://your-api-domain.com/health

# Test extension login flow
# Open extension popup and check browser console

# Verify webhook delivery
# Check Stripe dashboard → Webhooks → Recent deliveries
```
