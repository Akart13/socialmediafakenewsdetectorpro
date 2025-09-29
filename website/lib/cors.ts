import { NextRequest, NextResponse } from "next/server";

export function withCors(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    const origin = req.headers.get('origin');
    const allowed = [
      "https://fact-checker-website.vercel.app",
      "chrome-extension://*" // Allow all Chrome extensions
    ];
    
    if (origin && (allowed.includes(origin) || origin.startsWith("chrome-extension://"))) {
      const response = await handler(req);
      
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Vary", "Origin");
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Access-Control-Allow-Headers", "content-type, cookie");
      response.headers.set("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
      
      return response;
    }
    
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204 });
    }
    
    return await handler(req);
  };
}
