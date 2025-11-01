# Social Media Fact Checker Chrome Extension

A Chrome Extension (Manifest V3) that provides AI-powered fact-checking for social media posts on Twitter/X, Instagram, and Facebook. The extension integrates with a Next.js backend API to provide comprehensive claim extraction, source verification, and credibility scoring.

## Features

- **Multi-Platform Support**: Works on Twitter/X, Instagram, and Facebook
- **AI-Powered Analysis**: Uses Google Gemini 2.5 Flash Lite for claim extraction and fact-checking
- **Image Text Extraction**: Extracts text from images using Gemini Vision API
- **Credibility Scoring**: Provides detailed credibility ratings (1-10) for individual claims and overall posts
- **Source Grounding**: Automatically finds and verifies sources using Google Search grounding
- **Interactive UI**: Clean, modern overlay interface with expandable claim details
- **User Authentication**: Integrated with Firebase for secure user management
- **Usage Tracking**: Displays daily usage statistics in popup

## Installation

### From Source

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right corner)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. The extension icon should appear in your Chrome toolbar

### Configuration

Before using the extension, ensure the backend API is running:

1. Update `API_BASE_URL` in `background.js` to match your backend URL:
   ```javascript
   const API_BASE_URL = 'https://your-backend-url.com';
   ```

2. The extension will automatically handle authentication through the website

## How It Works

### Platform Detection

The extension automatically detects which social media platform you're on:
- **Twitter/X**: Detects `twitter.com` or `x.com` domains
- **Instagram**: Detects `instagram.com` domain
- **Facebook**: Detects `facebook.com` domain

### Fact-Checking Process

1. **Post Detection**: Content script scans the page for social media posts
2. **Button Injection**: Adds "Fact Check" buttons to each post
3. **Content Extraction**: When clicked, extracts:
   - Post text content
   - Images (up to 5 per post)
   - Post date and metadata
4. **Image Processing**: Converts images to base64 and extracts text via OCR
5. **Claim Extraction**: Uses Prompt API (LanguageModel) to identify 2-3 verifiable claims
6. **Fact-Checking**: Sends claims to backend API for analysis with source grounding
7. **Result Display**: Shows interactive overlay with:
   - Overall credibility rating and explanation
   - Individual claim analysis with ratings
   - Source citations with credibility and relevance scores

### File Structure

```
extension/
├── manifest.json          # Extension configuration (MV3)
├── background.js          # Service worker for API calls and Prompt API bridge
├── content.js            # Main content script for post detection and UI injection
├── popup.html           # Popup interface HTML
├── popup.js             # Popup functionality (user status, statistics)
├── styles.css           # Extension styling
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

## Key Components

### Content Script (`content.js`)

The main content script that runs on social media pages:

- **SocialMediaExtractor Class**: Main class managing all fact-checking functionality
  - Platform detection
  - Post element finding and button injection
  - Content extraction (text, images, dates)
  - Image to base64 conversion
  - Fact-check request handling
  - Result display in interactive overlay

**Key Methods**:
- `detectPlatform()`: Identifies current social media platform
- `addFactCheckButtons()`: Scans page and adds buttons to posts
- `extractPostData()`: Extracts all relevant data from a post
- `factCheckPost()`: Main fact-checking workflow
- `showInteractiveOverlay()`: Displays results in modal overlay

### Background Service Worker (`background.js`)

Handles API communication and Prompt API bridge:

- **Message Routing**: Routes messages from content script to appropriate handlers
- **API Communication**: Makes requests to backend API endpoints
- **Image Fetching**: Handles CORS issues by fetching images via service worker
- **Prompt API Bridge**: Provides LanguageModel API access for claim extraction
- **User Status**: Retrieves user authentication status and quota info
- **Statistics**: Tracks fact-check usage in local storage

**Key Functions**:
- `handleFactCheck()`: Forwards fact-check requests to backend API
- `handleImageExtraction()`: Sends images to backend for OCR
- `handleFetchImageAsBase64()`: Fetches images bypassing CORS
- `getUserStatus()`: Checks user authentication and plan
- `updateStats()`: Updates local usage statistics

### Popup (`popup.js`)

User interface for extension management:

- **PopupManager Class**: Manages popup interface
  - User authentication status display
  - Plan information (Free/Pro)
  - Usage statistics (total checks, today's checks)
  - Sign-in and upgrade button handlers

**Key Methods**:
- `loadUserStatus()`: Fetches and displays user information
- `loadStats()`: Displays fact-check statistics
- `updateUserUI()`: Updates UI based on user authentication status

## API Integration

The extension communicates with the backend API through the background service worker:

### Endpoints Used

- `POST /api/fact-check`: Main fact-checking endpoint
- `POST /api/image-extraction`: Image text extraction
- `GET /api/me`: User information and quota
- `GET /api/auth/unified`: Authentication endpoint

### Authentication

The extension uses session cookies for authentication:
- Session cookies are set by the website after Google OAuth
- Cookies are sent with all API requests via `credentials: 'include'`
- Extension automatically redirects to login if authentication fails

## Usage

### Basic Usage

1. Navigate to Twitter, Instagram, or Facebook
2. Browse your feed - fact-check buttons will appear on posts
3. Click the "Fact Check" button on any post
4. Wait for analysis (typically 10-30 seconds)
5. Review results in the interactive overlay

### Understanding Results

- **Overall Rating**: 1-10 credibility score for the entire post
- **Individual Claims**: Each claim gets its own rating and explanation
- **Sources**: List of sources with credibility and relevance scores
- **Confidence**: AI's confidence level in the assessment

### Popup Features

Click the extension icon to:
- View your current plan (Free/Pro)
- See remaining fact checks (Free users)
- Check total usage statistics
- Sign in or upgrade your plan

## Development

### Making Changes

1. Edit the source files (`content.js`, `background.js`, `popup.js`)
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes on a social media platform

### Testing

- Test on all supported platforms (Twitter, Instagram, Facebook)
- Verify button injection on dynamically loaded content
- Test authentication flow from extension popup
- Verify quota limits for free users

### Debugging

- Open browser DevTools (F12)
- Check Console tab for JavaScript errors
- Check Network tab for API requests
- Use Extension Service Worker DevTools for background script debugging

## Troubleshooting

### Buttons Not Appearing

- Verify you're on a supported platform (Twitter, Instagram, Facebook)
- Check browser console for errors
- Try refreshing the page
- Verify the extension is enabled

### Authentication Issues

- Click extension icon and try "Sign In"
- Ensure website is accessible
- Check that cookies are enabled
- Verify backend API is running

### API Errors

- Check internet connectivity
- Verify backend API is accessible
- Check browser console for detailed error messages
- Verify you haven't exceeded daily limits (free users)

### Extension Context Invalidated

- This happens when the extension is reloaded
- Refresh the page to restore functionality
- The extension will show a notification if this occurs

## Privacy & Security

- **No Data Collection**: Extension doesn't collect personal information
- **Secure Communication**: All API calls use HTTPS
- **Session Cookies**: Secure, HttpOnly cookies for authentication
- **Source Code**: All code is open source and auditable

## Limitations

- Maximum 5 images per post
- Free users limited to 5 fact checks per day
- Requires internet connection for API calls
- Processing time depends on API response (10-30 seconds typical)

## License

This extension is part of the Social Media Fact Checker project and is available under the MIT License.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Verify all requirements are met (backend API running, authentication set up)
4. See main project README for backend setup instructions