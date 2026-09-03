import { currentUser, signupOpen } from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

/** Who is signed in, and whether anyone can sign up. Never 401s — it is the question. */
export async function GET() {
  try {
    await ready();
    return ok({ user: await currentUser(), signupOpen: await signupOpen() });
  } catch (e) {
    return caught(e);
  }
}
