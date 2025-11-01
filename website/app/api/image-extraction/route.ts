import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { withCors } from "@/lib/cors";
import { db } from "@/lib/firebaseAdmin";

// Force Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Gemini API configuration for vision
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
const API_KEY = process.env.GEMINI_API_KEY!;

const DAILY_FREE_LIMIT = 5;

/**
 * Extracts text content from images using Gemini Vision API.
 * Converts base64 image data and sends it to the vision model for OCR processing.
 * 
 * @param {string[]} images - Array of base64-encoded image data URIs
 * @param {string} prompt - Optional custom prompt for text extraction (uses default if not provided)
 * @returns {Promise<string>} Extracted text content from all images
 */
async function extractTextFromImages(images: string[], prompt?: string): Promise<string> {
  const defaultPrompt = `Extract all text content from this image. Include:
1. Any visible text, captions, or labels
2. Headlines or titles
3. Any quotes or claims visible in the image
4. Text from signs, screenshots, or documents

Return the extracted text in a clear, organized format. If there are multiple claims or statements, list them as bullet points.
If no text is found, return "No text detected in image."`;

  const extractionPrompt = prompt || defaultPrompt;

  // Prepare image parts - convert base64 data URIs to inline_data format
  const imageParts = images.map((imageData) => {
    // Handle both data URIs and raw base64
    let mimeType = 'image/png';
    let base64Data = imageData;

    if (imageData.startsWith('data:')) {
      // Extract mime type and base64 data from data URI
      const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      } else {
        // Fallback: try to extract just base64 part
        const base64Match = imageData.match(/base64,(.+)$/);
        if (base64Match) {
          base64Data = base64Match[1];
        }
      }
    }

    return {
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    };
  });

  // Prepare the request body with image and text prompt
  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        ...imageParts,
        { text: extractionPrompt }
      ]
    }],
    generationConfig: {
      maxOutputTokens: 4096,
      candidateCount: 1,
      temperature: 0.0,
    }
  };

  console.log("=== IMAGE EXTRACTION API CALL ===");
  console.log(`Processing ${images.length} image(s)`);
  
  const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('Image Extraction API error details:', {
      status: response.status,
      statusText: response.statusText,
      errorData: errorData,
      url: GEMINI_API_URL
    });
    throw new Error(`Gemini Vision API error: ${response.status} ${response.statusText} - ${errorData}`);
  }

  const responseData = await response.json();
  console.log("=== IMAGE EXTRACTION API RESPONSE ===");
  
  // Extract text from response
  const extractedText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  if (!extractedText || extractedText.trim().length === 0) {
    return "No text could be extracted from the provided images.";
  }

  return extractedText.trim();
}

/**
 * Extracts verifiable claims from extracted image text using Gemini API.
 * Processes the text to identify 2-3 key claims that can be fact-checked.
 * 
 * @param {string} text - The extracted text from images to analyze
 * @returns {Promise<string>} Bullet-point formatted list of extracted claims
 */
async function extractClaimsFromText(text: string): Promise<string> {
  if (!text || text.length < 10) {
    return "";
  }

  const prompt = `Extract 2-3 verifiable claims from the following text extracted from an image. Each claim should be a single statement that can be verified or denied.

Text from image:
${text.slice(0, 4000)}

Return ONLY short bullet points, each starting with '- '. Do not include any analysis, commentary, emojis, or extra text. Just the claims.`;

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      maxOutputTokens: 1024,
      candidateCount: 1,
      temperature: 0.0,
    }
  };

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.warn('Claim extraction failed, returning empty claims');
      return "";
    }

    const responseData = await response.json();
    const claims = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return claims.trim();
  } catch (error) {
    console.warn('Claim extraction error:', error);
    return "";
  }
}

/**
 * Main request handler for image extraction API endpoint.
 * Authenticates user, checks quota limits, validates input images, extracts text,
 * and optionally extracts claims from the text.
 * 
 * @param {NextRequest} req - The incoming request object
 * @returns {Promise<NextResponse>} Response containing extracted text and claims or error
 */
async function handler(req: NextRequest) {
  try {
    // Check authentication
    const user = await requireAuth(req);
    
    // Get user data and check quota
    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data()! : { plan: 'free' };
    
    // Check if user is on pro plan
    const isPro = userData.plan === 'pro';
    
    // Check daily quota for free users
    if (!isPro) {
      const today = new Date().toISOString().slice(0, 10);
      const usage = userData.usage || { date: today, count: 0 };
      
      // Reset count if it's a new day
      if (usage.date !== today) {
        usage.date = today;
        usage.count = 0;
      }
      
      // Check if quota exceeded
      if (usage.count >= DAILY_FREE_LIMIT) {
        return NextResponse.json({ 
          error: "Free quota exceeded", 
          upgradeUrl: "https://fact-checker-website.vercel.app/billing" 
        }, { status: 402 });
      }
      
      // Increment usage count
      usage.count += 1;
      await db.collection('users').doc(user.uid).set({
        usage: usage
      }, { merge: true });
    }

    const { images, extractClaims } = await req.json();
    
    // Validate input
    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    // Limit number of images per request
    if (images.length > 5) {
      return NextResponse.json({ error: "Maximum 5 images per request" }, { status: 400 });
    }

    // Validate each image is base64 encoded
    for (const image of images) {
      if (!image || typeof image !== 'string') {
        return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
      }
    }

    console.log('Processing image extraction request:', {
      imageCount: images.length,
      extractClaims: extractClaims || false
    });

    // Extract text from images
    const extractedText = await extractTextFromImages(images);

    // Optionally extract claims from the extracted text
    let claims = "";
    if (extractClaims) {
      claims = await extractClaimsFromText(extractedText);
    }

    return NextResponse.json({
      success: true,
      extractedText,
      claims: claims || undefined,
      imageCount: images.length
    });
  } catch (e: any) {
    console.error("Image extraction error:", e?.response?.data || e?.message || e);
    const msg = e?.message || "unknown";
    const isBadReq = /400/i.test(msg);
    return NextResponse.json({ 
      error: `Image extraction error: ${msg}`,
      success: false
    }, { status: isBadReq ? 400 : 500 });
  }
}

export const POST = withCors(handler);
