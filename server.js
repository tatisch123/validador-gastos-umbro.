// Servidor del Validador de Gastos Corporativos.
// Sirve la página y hace de intermediario con Pollinations usando la clave
// guardada en la variable de entorno POLLINATIONS_KEY (nunca llega al navegador).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = (process.env.POLLINATIONS_KEY || '').trim();
const API = 'https://gen.pollinations.ai';
const SHEETS = (process.env.SHEETS_URL || '').trim();
const SHEET_LINK = (process.env.SHEET_LINK || '').trim();
const LIMITE_POR_HORA = Number(process.env.LIMITE_POR_HORA || 120); // pedidos por visitante por hora

const visitas = new Map();
function permitido(ip){
  const ahora = Date.now(), hora = 3600e3;
  const lista = (visitas.get(ip) || []).filter(t => ahora - t < hora);
  if (lista.length >= LIMITE_POR_HORA) { visitas.set(ip, lista); return false; }
  lista.push(ahora); visitas.set(ip, lista); return true;
}

function leerCuerpo(req){
  return new Promise((res, rej) => { const partes = []; req.on('data', c => partes.push(c)); req.on('end', () => res(Buffer.concat(partes))); req.on('error', rej); });
}

async function reenviar(res, url, opciones){
  try {
    const r = await fetch(url, opciones);
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = {'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store'};
    const ra = r.headers.get('retry-after'); if (ra) headers['Retry-After'] = ra;
    res.writeHead(r.status, headers); res.end(buf);
  } catch (e) {
    res.writeHead(502, {'Content-Type': 'application/json'}); res.end(JSON.stringify({ok: false, error: 'No se pudo conectar con el servicio externo'}));
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const auth = {Authorization: 'Bearer ' + KEY};

  if (u.pathname === '/api/status'){
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    return res.end(JSON.stringify({hasKey: !!KEY, hasSheets: !!SHEETS, sheetLink: SHEET_LINK}));
  }
  if (u.pathname === '/api/sheets'){
    if (!SHEETS){ res.writeHead(503, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({ok: false, error: 'Falta configurar SHEETS_URL en Render'})); }
    if (req.method === 'POST'){
      const body = await leerCuerpo(req);
      return reenviar(res, SHEETS, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body, redirect: 'follow'});
    }
    return reenviar(res, SHEETS + (SHEETS.includes('?') ? '&' : '?') + 't=' + Date.now(), {redirect: 'follow'});
  }
  if (u.pathname.startsWith('/api/')){
    if (!KEY){ res.writeHead(503, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({error: 'Falta configurar POLLINATIONS_KEY en Render'})); }
    if (!permitido(ip)){ res.writeHead(429, {'Content-Type': 'application/json', 'Retry-After': '60'}); return res.end(JSON.stringify({error: 'Demasiados pedidos, esperá un minuto'})); }
    if (u.pathname === '/api/chat' && req.method === 'POST'){
      const body = await leerCuerpo(req);
      return reenviar(res, API + '/v1/chat/completions', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, auth), body});
    }
    if (u.pathname.startsWith('/api/image/') && req.method === 'GET'){
      const prompt = u.pathname.slice('/api/image/'.length);
      return reenviar(res, API + '/image/' + prompt + u.search, {headers: auth});
    }
    if (u.pathname === '/api/edits' && req.method === 'POST'){
      const body = await leerCuerpo(req);
      return reenviar(res, API + '/v1/images/edits', {method: 'POST', headers: Object.assign({'Content-Type': req.headers['content-type']}, auth), body});
    }
    res.writeHead(404); return res.end();
  }
  // Página
  let archivo = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  archivo = path.join(__dirname, path.normalize(archivo).replace(/^(\.\.[\/\\])+/, ''));
  if (!archivo.startsWith(__dirname)){ res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, data) => {
    if (err){ res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('No encontrado'); }
    const tipos = {'.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript'};
    res.writeHead(200, {'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream'}); res.end(data);
  });
});

server.listen(PORT, () => console.log('Validador de Gastos listo en el puerto ' + PORT + (KEY ? ' (con clave de Pollinations)' : ' (SIN clave: configurá POLLINATIONS_KEY)')));
