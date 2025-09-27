// Image text extraction using Google Gemini Vision API
class ImageTextExtractor {
  constructor() {
    this.apiKey = null;
  }

  cleanJsonResponse(response) {
    // Remove markdown code blocks and clean up the response
    let cleaned = response.trim();
    
    // Remove ```json and ``` markers
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/```\s*$/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    // If the response doesn't start with [ or {, try to find the JSON part
    if (!cleaned.startsWith('[') && !cleaned.startsWith('{')) {
      const jsonMatch = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (jsonMatch) {
        cleaned = jsonMatch[1];
      }
    }
    
    // Additional cleaning for common JSON issues
    try {
      // Try to parse and re-stringify to validate and clean
      const parsed = JSON.parse(cleaned);
      return JSON.stringify(parsed);
    } catch (error) {
      // If parsing fails, try to fix common issues
      console.warn('JSON parsing failed, attempting to fix:', error.message);
      
      // Fix common issues:
      // 1. Unescaped quotes in strings
      cleaned = cleaned.replace(/([^\\])"([^"]*)"([^,}\]]*)/g, (match, before, content, after) => {
        // Only fix if it looks like an unescaped quote in a string value
        if (before.match(/[:\s]/) && after.match(/[,}\]]/)) {
          const escapedContent = content.replace(/"/g, '\\"');
          return `${before}"${escapedContent}"${after}`;
        }
        return match;
      });
      
      // 2. Remove trailing commas
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
      
      // 3. Fix missing quotes around keys
      cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      
      // 4. Remove any non-JSON content that might be mixed in
      const lines = cleaned.split('\n');
      const jsonLines = [];
      let inJson = false;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          inJson = true;
        }
        if (inJson) {
          jsonLines.push(line);
          if (trimmed.endsWith(']') || trimmed.endsWith('}')) {
            break;
          }
        }
      }
      
      if (jsonLines.length > 0) {
        cleaned = jsonLines.join('\n');
      }
      
      return cleaned;
    }
  }

  async initialize() {
    this.apiKey = await this.getApiKey();
  }

  async getApiKey() {
    // Use the provided API key directly
    return 'AIzaSyCsOPdyQQWuO-Eby6L7scmZ4SJSx_f5tfo';
  }

  async extractTextFromImages(images) {
    // Validate input
    if (!Array.isArray(images)) {
      return [];
    }
    
    if (!this.apiKey) {
      await this.initialize();
    }

    if (!this.apiKey) {
      throw new Error('Google Gemini API key not configured');
    }

    const extractedTexts = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      // Validate image object
      if (!image || !image.src || typeof image.src !== 'string') {
        console.warn('Invalid image object:', image);
        continue;
      }
      
      // Add delay between image processing to avoid rate limits
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
      }
      
      try {
        const text = await this.extractTextFromImage(image);
        if (text && typeof text === 'string' && text.trim()) {
          extractedTexts.push({
            imageUrl: image.src,
            extractedText: text.trim()
          });
        }
      } catch (error) {
        console.warn('Failed to extract text from image:', image.src, error);
        // Continue with other images even if one fails
      }
    }

    return extractedTexts;
  }

  async extractTextFromImage(image) {
    try {
      // Convert image to base64
      const base64Image = await this.imageToBase64(image.src);
      
      // Call Gemini Vision API
      const response = await this.callGeminiVisionAPI(base64Image);
      
      return response;
    } catch (error) {
      console.error('Error extracting text from image:', error);
      throw error;
    }
  }

  async imageToBase64(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw image to canvas
        ctx.drawImage(img, 0, 0);
        
        // Convert to base64
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(base64);
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = imageUrl;
    });
  }

  async callGeminiVisionAPI(base64Image, retryCount = 0) {
    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds base delay
    
    const prompt = `
      Extract all text from this image. This could be:
      - Text overlays on images
      - Screenshots of articles or documents
      - Text in memes or infographics
      - Captions or subtitles
      - Any other readable text content
      
      Return only the extracted text, without any additional commentary or formatting.
      If there's no readable text in the image, return "No text found".
    `;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: prompt
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image.split(',')[1] // Remove data:image/jpeg;base64, prefix
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.8,
            maxOutputTokens: 1024,
          }
        })
      });

      if (!response.ok) {
        if (response.status === 429 && retryCount < maxRetries) {
          // Rate limit hit - wait and retry with exponential backoff
          const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
          console.log(`Vision API rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.callGeminiVisionAPI(base64Image, retryCount + 1);
        }
        
        const errorData = await response.json();
        throw new Error(`Gemini Vision API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response from Gemini Vision API');
      }

      const extractedText = data.candidates[0].content.parts[0].text;
      
      // Clean up the response
      return extractedText.replace(/^"|"$/g, '').trim();
    } catch (error) {
      if (error.message.includes('429') && retryCount < maxRetries) {
        // Network error with 429 - retry with exponential backoff
        const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
        console.log(`Vision API network error, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callGeminiVisionAPI(base64Image, retryCount + 1);
      }
      throw error;
    }
  }

  // Enhanced method for extracting text with context
  async extractTextWithContext(images) {
    if (!this.apiKey) {
      await this.initialize();
    }

    if (!this.apiKey) {
      throw new Error('Google Gemini API key not configured');
    }

    const results = [];

    for (const image of images) {
      try {
        const result = await this.extractTextWithContextFromImage(image);
        results.push(result);
      } catch (error) {
        console.warn('Failed to extract text with context from image:', image.src, error);
        results.push({
          imageUrl: image.src,
          extractedText: '',
          context: '',
          confidence: 0,
          error: error.message
        });
      }
    }

    return results;
  }

  async extractTextWithContextFromImage(image) {
    try {
      const base64Image = await this.imageToBase64(image.src);
      
      const prompt = `
        Analyze this image and extract any text content along with its context.
        
        For each piece of text found, provide:
        1. The extracted text
        2. The context or purpose of the text (e.g., "headline", "caption", "quote", "statistic", "meme text")
        3. Your confidence in the accuracy of the extraction (0-1)
        
        Return the result in this JSON format:
        {
          "extractedText": "All text found in the image",
          "context": "Description of what type of content this appears to be",
          "confidence": 0.95,
          "textElements": [
            {
              "text": "specific text element",
              "type": "headline/caption/quote/etc",
              "confidence": 0.9
            }
          ]
        }
        
        If no text is found, return:
        {
          "extractedText": "",
          "context": "No readable text found",
          "confidence": 0,
          "textElements": []
        }
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: prompt
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image.split(',')[1]
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.8,
            maxOutputTokens: 2048,
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini Vision API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response from Gemini Vision API');
      }

      const responseText = data.candidates[0].content.parts[0].text;
      
      try {
        const cleanedResponse = this.cleanJsonResponse(responseText);
        const result = JSON.parse(cleanedResponse);
        return {
          imageUrl: image.src,
          ...result
        };
      } catch (parseError) {
        // Fallback to simple text extraction if JSON parsing fails
        return {
          imageUrl: image.src,
          extractedText: responseText,
          context: 'Text extracted from image',
          confidence: 0.7,
          textElements: []
        };
      }
    } catch (error) {
      console.error('Error extracting text with context from image:', error);
      throw error;
    }
  }

  // Method to check if an image likely contains text
  async hasTextContent(imageUrl) {
    try {
      const base64Image = await this.imageToBase64(imageUrl);
      
      const prompt = `
        Does this image contain any readable text? Answer with just "yes" or "no".
        Consider text overlays, captions, screenshots, memes, infographics, or any other text content.
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: prompt
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image.split(',')[1]
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 1,
            topP: 0.8,
            maxOutputTokens: 10,
          }
        })
      });

      if (!response.ok) {
        return false; // Assume no text if API call fails
      }

      const data = await response.json();
      const answer = data.candidates[0].content.parts[0].text.toLowerCase().trim();
      
      return answer.includes('yes');
    } catch (error) {
      console.warn('Error checking for text content:', error);
      return false;
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageTextExtractor;
}
