import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });
const lidar = new LidarDriver();

let latestScanData: ScanData | null = null;

lidar.on('scan', (data: ScanData) => {
  latestScanData = data;
});

const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Lidar Monitor</title>
    <style>
        body { font-family: sans-serif; text-align: center; background: #222; color: #fff; }
        #controls { margin: 20px; padding: 15px; background: #333; border-radius: 8px; display: inline-block; }
        input { padding: 5px; width: 120px; text-align: center; }
        button { padding: 6px 12px; cursor: pointer; background: #555; color: white; border: none; border-radius: 4px; margin: 2px;}
        button:hover { background: #777; }
        button.primary { background: #007bff; }
        button.danger { background: #dc3545; }
        canvas { background: #000; border: 2px solid #555; border-radius: 50%; margin-top: 10px; }
        .status { font-weight: bold; margin-left: 10px; }
        .connected { color: #0f0; }
        .disconnected { color: #f00; }
    </style>
</head>
<body>
    <h1>Lidar Real-time Monitor</h1>
    
    <div id="controls">
        <label>IP: <input type="text" id="ip" value="192.168.0.10"></label>
        <label>Port: <input type="number" id="port" value="8000"></label>
        <br/><br/>
        <button class="primary" onclick="connectLidar()">1. Connect & Auto-Start</button>
        <button class="danger" onclick="disconnectLidar()">Disconnect</button>
        <br/><br/>
        <small>Manual Controls:</small><br/>
        <button onclick="sendCommand('SetAccessLevel,0000')">Login (0000)</button>
        <button onclick="sendCommand('SensorStart')">Sensor Start</button>
        <button onclick="sendCommand('SensorStop')">Sensor Stop</button>
        
        <p>Status: <span id="status" class="status disconnected">Disconnected</span></p>
    </div>
    
    <br/>
    <canvas id="lidarCanvas" width="800" height="800"></canvas>

    <script>
        const canvas = document.getElementById('lidarCanvas');
        const ctx = canvas.getContext('2d');
        const statusEl = document.getElementById('status');
        let isRunning = false;
        
        const CX = canvas.width / 2;
        const CY = canvas.height / 2;
        const SCALE = 30; 

        async function connectLidar() {
            const ip = document.getElementById('ip').value;
            const port = parseInt(document.getElementById('port').value);
            
            try {
                const res = await fetch('/connect', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ip, port })
                });
                const data = await res.json();
                
                if (data.status === 'connected' || data.status === 'already_connected') {
                    statusEl.textContent = 'Connected (Initializing...)';
                    statusEl.className = 'status connected';
                    if (!isRunning) {
                        isRunning = true;
                        updateLoop();
                    }
                } else {
                    alert('Connection Failed: ' + data.message);
                }
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function sendCommand(cmd) {
            await fetch('/command', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ command: cmd })
            });
        }

        async function disconnectLidar() {
            await fetch('/disconnect', { method: 'POST' });
            statusEl.textContent = 'Disconnected';
            statusEl.className = 'status disconnected';
            isRunning = false;
            ctx.clearRect(0,0,canvas.width, canvas.height);
        }

        async function updateLoop() {
            if (!isRunning) return;
            try {
                const res = await fetch('/scan');
                if (res.status === 200) {
                    const scan = await res.json();
                    if (!scan.status) { 
                        statusEl.textContent = 'Receiving Data (' + scan.amountOfData + ' points)';
                        drawLidar(scan);
                    }
                }
            } catch (e) {}
            setTimeout(updateLoop, 50);
        }

        function drawLidar(scan) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 그리드
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for(let r=5; r<=30; r+=5) {
                ctx.arc(CX, CY, r * SCALE, 0, Math.PI * 2);
            }
            ctx.stroke();

            // 점 그리기
            ctx.fillStyle = '#0f0';
            const startAngleDeg = scan.angleBegin / 10000.0; // C++: / 10000.0 (단위 확인됨)
            const stepAngleDeg = scan.angleResol / 10000.0; 

            for (let i = 0; i < scan.ranges.length; i++) {
                const dist = scan.ranges[i];
                if (dist <= 0.1) continue; 

                // 화면 좌표 변환 (-90도 회전 보정)
                const angleDeg = startAngleDeg + (i * stepAngleDeg); 
                const angleRad = ((angleDeg - 90) * Math.PI) / 180.0;

                const x = CX + (Math.cos(angleRad) * dist * SCALE);
                const y = CY + (Math.sin(angleRad) * dist * SCALE);
                ctx.fillRect(x, y, 3, 3);
            }
        }
    </script>
</body>
</html>
`;

fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
  const { ip, port } = request.body;
  try {
    if (!lidar.isConnected()) {
        await lidar.connect(ip, port || 8000);
    }
    
    // [중요] 연결 후 명령어 순차 전송
    // 1. 로그인 (0.5초 후)
    setTimeout(() => lidar.sendCommand('SetAccessLevel,0000'), 500);
    
    // 2. 센서 시작 (1초 후)
    setTimeout(() => lidar.sendCommand('SensorStart'), 1000);

    return { status: 'connected', ip, port: port || 8000 };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

fastify.post('/disconnect', async (request, reply) => {
  lidar.disconnect();
  return { status: 'disconnected' };
});

fastify.get('/scan', async (request, reply) => {
  if (!lidar.isConnected()) return { status: 'error', message: 'Not connected' };
  if (!latestScanData) return { status: 'waiting_for_data' };
  return latestScanData;
});

fastify.post<{ Body: { command: string } }>('/command', async (request, reply) => {
  try {
    lidar.sendCommand(request.body.command);
    return { status: 'sent', command: request.body.command };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    process.exit(1);
  }
};

start();