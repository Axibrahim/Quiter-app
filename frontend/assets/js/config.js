/**
 * The ONE place the frontend learns where the backend lives.
 *
 * Before you deploy: set PROD_API_BASE to your backend URL (must end in /api/v1).
 * On localhost / 127.0.0.1 / file:// it automatically uses the local Flask server.
 * (You can also override per page with <script>window.QUITER_API_BASE='...'</script>
 * placed before the module scripts.)
 */
const PROD_API_BASE = '/api/v1';   // same origin: Flask serves both the pages and the API

const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

// Local development follows the page's protocol, so an https:// dev page talks to an https:// dev API
// (browsers block an https page from calling plain http for anything but loopback, and iOS needs https for PWAs).
const localProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

export const API_BASE = window.QUITER_API_BASE || (isLocal ? `${localProtocol}//127.0.0.1:5000/api/v1` : PROD_API_BASE);