const express = require('express');
const http = require('http');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { Server } = require('socket.io');
const pty = require('node-pty');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",  // ganti sesuai origin frontend kamu
    methods: ["GET", "POST"]
  }
});

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    console.log('Client connected', socket.id);

    socket.on('get-samba-path', () => {
      const cmd = `sed -n '/^\\[backups\\]/,/^\\[/p' /etc/samba/smb.conf | sed '$d' | grep '^\\s*path\\s*=\\s*' | sed 's/^\\s*path\\s*=\\s*//'`;

      const shell = pty.spawn('bash', ['-c', cmd], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
      });

      let output = '';

      shell.onData((data) => {
        output += data;
      });

      shell.onExit(() => {
        const path = output.trim();
        socket.emit('samba-path', path);
      });
    });

    // Koneksi SSH (gunakan ssh di shell, bukan library ssh)
    socket.on('ssh', () => {
      const shell = pty.spawn('bash', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
      });

      shell.on('data', (data) => {
        console.log(data);
        io.emit('message', data);
      });

      socket.on('input', (data) => {
        io.write(data);
      });

      socket.on('resize', (size) => {
        io.resize(size.cols, size.rows);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected', socket.id);
        shell.kill();
      });

      socket.on('message', (msg) => {
        console.log('Received message:', msg);
        shell.write(msg);
        console.log('🖋️ Sent to shell:', JSON.stringify(msg));
        // Kirim balik ke semua client (broadcast)
        // io.emit('message', msg);
      });

      //socket.on('disconnect', () => {
      //  console.log('Client disconnected', socket.id);
      //});
    });
    
    let term = null;

    socket.on('open-terminal', () => {
      const os = require('os');
      const pty = require('node-pty');

      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      term = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME,
        env: process.env
      });

      term.on('data', (data) => {
        socket.emit('terminal-output', data);
      });

      console.log('Terminal opened');
    });

    socket.on('terminal-input', (data) => {
      if (term) {
        term.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }) => {
      if (term) {
        term.resize(cols, rows);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      if (term) {
        term.kill();
      }
    });
  });

  server.listen(6001, () => {
    console.log('Socket.IO server running on port 6001');
  });
}).catch(console.error);
