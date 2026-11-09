"""Static server with CORS (so the extension service worker may fetch test fixtures)."""
import http.server, sys, os

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

os.chdir(sys.argv[2] if len(sys.argv) > 2 else '.')
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
