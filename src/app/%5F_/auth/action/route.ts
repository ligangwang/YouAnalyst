import { emailActionResponse } from "@/lib/firebase/email-action";

// Encode the leading underscore: a literal __ folder is private in Next.js.
export function GET(request: Request) {
  return emailActionResponse(request, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
}
