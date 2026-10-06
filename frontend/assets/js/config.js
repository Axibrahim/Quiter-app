/**
 * The ONE place the frontend learns where the backend lives.
 *
 * Before you deploy: set PROD_API_BASE to your backend URL (must end in /api/v1).
 * On localhost / 127.0.0.1 / file:// it automatically uses the local Flask server.
 * (You can also override per page with <script>window.QUITER_API_BASE='...'</script>
 * placed before the module scripts.)
 */
const PROD_API_BASE = 'https://YOUR-BACKEND-DOMAIN/api/v1';

const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

export const API_BASE = window.QUITER_API_BASE || (isLocal ? 'http://127.0.0.1:5000/api/v1' : PROD_API_BASE);