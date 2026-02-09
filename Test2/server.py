#!/usr/bin/env python3
"""
Simple HTTP server for the 2D game
Run this script and open http://localhost:8000 in your browser
"""
import http.server
import socketserver
import os
import sys

PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        # Override for specific file types first
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.js'):
            return 'application/javascript'
        
        # For other files, use parent's guess_type
        # In Python's http.server, guess_type returns a string (mimetype)
        mimetype = super().guess_type(path)
        return mimetype
    
    def log_message(self, format, *args):
        # Suppress default logging to reduce noise
        pass

if __name__ == "__main__":
    # Change to script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    Handler = MyHTTPRequestHandler
    
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print(f"Server running at http://localhost:{PORT}/")
            print(f"Serving directory: {script_dir}")
            print("Open http://localhost:8000/index.html in your browser")
            print("Press Ctrl+C to stop the server")
            httpd.serve_forever()
    except OSError as e:
        if "Address already in use" in str(e) or "Only one usage of each socket address" in str(e):
            print(f"Port {PORT} is already in use. Please stop any other server using this port.")
        else:
            print(f"Error starting server: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nServer stopped.")
