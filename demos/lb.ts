// A round-robin load balancer with no sticky sessions: request 1 goes to A, request 2 to B, and so on.
// This is how a serverless platform behaves: any request can land on any instance.
import http from 'node:http';

const instances = [3001, 3002]; // instance A, instance B
let next = 0;

http.createServer((req, res) => {
  const port = instances[next++ % instances.length];
  const forward = http.request({ port, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  forward.on('error', () => { res.writeHead(502); res.end('instance is down\n'); });
  req.pipe(forward);
}).listen(3000, () => console.log('load balancer :3000 -> round robin over', instances.join(', ')));
