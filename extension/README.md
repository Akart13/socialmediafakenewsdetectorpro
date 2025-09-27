# Social Media Fact Checker Chrome Extension

A Chrome extension that uses Google Gemini 2.5 Flash AI to fact-check tweets, Instagram posts, and Facebook posts. The extension can extract text from images and provides credibility ratings for individual claims and overall posts.

## Features

- 🔍 **Multi-Platform Support**: Works on Twitter/X, Instagram, and Facebook
- 🖼️ **Image Text Extraction**: Uses AI to read text from images in posts
- 🧠 **AI-Powered Analysis**: Uses Google Gemini 2.5 Flash for claim extraction and fact-checking
- 📊 **Credibility Scoring**: Provides credibility and relevance scores for sources
- 🎯 **Grounding**: Finds relevant sources for each claim using AI grounding
- 📱 **Modern UI**: Clean, responsive interface with real-time results

## Setup Instructions

### 1. Add Your API Key

1. Go to line 1 of background.js
2. Replace the 'geminiAPIKey' variable with your Gemini API Key

### 2. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the extension folder
5. The extension should now appear in your extensions list

### 3. Configure the Extension

1. Click the extension icon in your browser toolbar
2. Configure your preferences:  
   * Auto-check new posts  
   * Extract text from images
3. Click "Save Settings"

### 4. Use the Extension

1. Visit Twitter, Instagram, or Facebook
2. Look for posts with a "🔍 Fact Check" button
3. Click the button to analyze the post
4. Wait for AI analysis (may take 10-30 seconds)
5. Review the results showing:  
   * Overall credibility rating  
   * Individual claim analysis  
   * Source credibility and relevance scores  
   * Detailed explanations

## How It Works

### 1. Text Extraction

* Extracts text from the post content
* Uses AI vision to read text from images
* Combines all text for comprehensive analysis

### 2. Claim Analysis

* AI identifies individual factual claims in the post
* Separates verifiable facts from opinions
* Focuses on claims that can be researched

### 3. Source Finding

* Uses AI grounding to find relevant sources
* Searches for authoritative sources (.gov, .edu, news organizations)
* Assigns credibility and relevance scores to each source

### 4. Credibility Assessment

* AI analyzes sources to rate each claim's credibility
* Provides confidence levels and explanations
* Calculates overall post credibility rating

## File Structure

```
├── manifest.json          # Extension configuration
├── background.js          # Service worker for API calls
├── content.js            # Main content script
├── image-extractor.js    # Image text extraction
├── popup.html           # Settings popup interface
├── popup.js             # Popup functionality
├── styles.css           # Extension styling
├── icons/               # Extension icons
└── README.md           # This file
```

## API Usage

The extension uses Google Gemini 2.5 Flash API for:

* Text extraction from images
* Claim identification and analysis
* Source finding with grounding
* Credibility assessment

## Privacy & Security

* API key is pre-configured and embedded in the extension
* No data is sent to third-party services except Google Gemini
* All processing happens through Google's secure API endpoints
* No personal data is collected or stored

## Troubleshooting

### Extension Not Working

* Ensure you're on a supported platform (Twitter, Instagram, Facebook)
* Try refreshing the page
* Check browser console for any error messages

### No Fact Check Button Appearing

* Make sure you're on a supported social media platform
* Check that the content script is loaded (look for errors in console)
* Try refreshing the page

### API Errors

* Check your internet connectivity
* Verify the Google Gemini API is accessible
* Check browser console for detailed error messages

## Development

To modify or extend the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh button on the extension card
4. Test your changes

## License

This project is open source and available under the MIT License.

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review the browser console for error messages
3. Ensure all requirements are met (API key, supported platforms)

## About

This extension is part of the paymentintegration project and provides fact-checking capabilities for social media content.
