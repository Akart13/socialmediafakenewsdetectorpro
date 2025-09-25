// Image text extraction utility for the Social Media Fact Checker extension
class ImageTextExtractor {
  constructor() {
    this.apiKey = null;
    this.init();
  }

  async init() {
    // Get API key from background script
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getApiKey' });
      this.apiKey = response?.apiKey;
    } catch (error) {
      console.warn('Failed to get API key for image extraction:', error);
    }
  }

  async extractTextFromImages(images) {
    if (!images || images.length === 0) {
      return [];
    }

    const results = [];
    
    for (const image of images) {
      try {
        const text = await this.extractTextFromImage(image);
        if (text && text.trim().length > 0) {
          results.push({
            src: image.src,
            extractedText: text.trim(),
            alt: image.alt || ''
          });
        }
      } catch (error) {
        console.warn('Failed to extract text from image:', error);
        // Continue with other images even if one fails
      }
    }
    
    return results;
  }

  async extractTextFromImage(image) {
    if (!this.apiKey) {
      throw new Error('API key not available for image text extraction');
    }

    try {
      // Convert image to base64
      const base64Image = await this.imageToBase64(image.src);
      
      // Call Gemini API for image text extraction
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: "Extract all text from this image. Return only the text content, no explanations or formatting."
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.8,
            maxOutputTokens: 1000,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const textContent = data.candidates[0].content.parts
          .filter(part => part.text)
          .map(part => part.text)
          .join(' ');
        
        return textContent || '';
      }
      
      return '';
    } catch (error) {
      console.error('Image text extraction failed:', error);
      throw error;
    }
  }

  async imageToBase64(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Set canvas dimensions
          canvas.width = img.width;
          canvas.height = img.height;
          
          // Draw image to canvas
          ctx.drawImage(img, 0, 0);
          
          // Convert to base64
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          resolve(base64);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image for text extraction'));
      };
      
      img.src = imageUrl;
    });
  }

  // Fallback method for when API is not available
  async extractTextFromImageFallback(image) {
    // This is a placeholder for when OCR or other text extraction methods are not available
    // In a real implementation, you might use:
    // - Tesseract.js for client-side OCR
    // - Canvas-based text detection
    // - Other image processing libraries
    
    return new Promise((resolve) => {
      // For now, return empty string as fallback
      // This prevents errors but doesn't extract text
      resolve('');
    });
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageTextExtractor;
} else if (typeof window !== 'undefined') {
  window.ImageTextExtractor = ImageTextExtractor;
}