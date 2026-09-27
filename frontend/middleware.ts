import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/signup', '/demo', '/landing']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const authed = Boolean(request.cookies.get('ailms_auth')?.value)

  // Unauthenticated visitors hitting the app root see the marketing landing page.
  if (!authed && pathname === '/') {
    const landing = request.nextUrl.clone()
    landing.pathname = '/landing'
    landing.search = ''
    return NextResponse.redirect(landing)
  }

  if (!isPublic && !authed) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if ((pathname === '/login' || pathname === '/signup' || pathname === '/landing') && authed) {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    home.search = ''
    return NextResponse.redirect(home)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)',
  ],
}
