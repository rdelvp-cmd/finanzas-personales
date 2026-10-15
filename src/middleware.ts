import { NextResponse, type NextRequest } from "next/server";

// Protección mínima: HTTP Basic con APP_PASSWORD (cualquier usuario).
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Finanzas"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
