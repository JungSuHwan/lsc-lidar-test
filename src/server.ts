import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });

// --- 다중 센서 상태 관리 ---
interface SensorContext {
    driver: LidarDriver;
    data: ScanData | null;
    ip: string;
    port: number;
}

// 센서 ID를 키로 하여 관리 (1, 2, 3...)
const sensors = new Map<number, SensorContext>();
let nextSensorId = 1;

// 공통 지연 함수 (ms)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 16진수 변환 헬퍼 함수
function toHex(num: number): string {
    return (num >>> 0).toString(16).toUpperCase();
}

// --- 웹 대시보드 HTML ---
const indexHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Multi-Lidar Dashboard</title>
    <style>
        body { background-color: #121212; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; }
        
        /* 사이드바 스타일 */
        #sidebar { width: 320px; background-color: #1e1e1e; padding: 20px; display: flex; flex-direction: column; border-right: 1px solid #333; z-index: 10; box-shadow: 2px 0 10px rgba(0,0,0,0.5); }
        h2 { border-bottom: 2px solid #007bff; padding-bottom: 10px; font-size: 1.1rem; margin-top: 0; }
        
        .control-group { background: #2c2c2c; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #333; }
        .input-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
        input[type="text"], input[type="number"] { background: #333; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; flex: 1; text-align: center; }
        
        button { width: 100%; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px; color: white; transition: 0.2s; }
        button.primary { background: #007bff; } button.primary:hover { background: #0056b3; }
        button.danger { background: #dc3545; } button.danger:hover { background: #a71d2a; }
        button.secondary { background: #444; } button.secondary:hover { background: #666; }

        /* 메인 대시보드 영역 (그리드) */
        #dashboard-container { flex: 1; padding: 20px; overflow-y: auto; background: #000; position: relative; }
        #dashboard-grid { display: flex; flex-wrap: wrap; gap: 20px; align-content: flex-start; }
        
        /* 개별 센서 카드 스타일 */
        .sensor-card { 
            background: #1a1a1a; border: 1px solid #333; border-radius: 8px; 
            width: 400px; height: 450px; display: flex; flex-direction: column; 
            position: relative; transition: border-color 0.2s;
        }
        .sensor-card.selected { border: 2px solid #00afff; box-shadow: 0 0 15px rgba(0, 175, 255, 0.2); }
        
        .card-header { 
            padding: 10px 15px; background: #252525; border-bottom: 1px solid #333; border-radius: 8px 8px 0 0;
            display: flex; justify-content: space-between; align-items: center;
        }
        .card-title { font-weight: bold; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
        .status-dot { width: 8px; height: 8px; background: #00ff00; border-radius: 50%; box-shadow: 0 0 5px #00ff00; }
        
        .card-body { flex: 1; position: relative; background: #000; cursor: crosshair; }
        .card-canvas { width: 100%; height: 100%; display: block; }
        
        .card-footer { 
            padding: 8px 15px; background: #252525; border-top: 1px solid #333; border-radius: 0 0 8px 8px; 
            font-size: 0.8rem; color: #888; display: flex; justify-content: space-between;
        }

        #empty-msg { width: 100%; text-align: center; color: #444; margin-top: 100px; font-size: 1.2rem; }
    </style>
</head>
<body>
    <div id="sidebar">
        <h2>Add Sensor</h2>
        <div class="control-group">
            <div class="input-row">
                <input type="text" id="new-ip" value="192.168.0.10" placeholder="IP Address">
                <input type="number" id="new-port" value="8000" placeholder="Port" style="width: 60px;">
            </div>
            <button class="primary" onclick="addSensor()">+ Connect Sensor</button>
        </div>

        <h2>Config Selected</h2>
        <div class="control-group">
            <div style="margin-bottom:10px; font-size:0.9rem; color:#00afff;">
                Target: <span id="cfg-target-id" style="font-weight:bold; color:#fff;">None</span>
            </div>
            <div class="input-row"><label>Min(°)</label><input type="number" id="scan-min" value="-45" step="1"></div>
            <div class="input-row"><label>Max(°)</label><input type="number" id="scan-max" value="225" step="1"></div>
            <button class="primary" onclick="applyConfig()">Apply Config</button>
            <div style="margin-top:10px;">
                <button class="danger" onclick="disconnectSelected()">Disconnect Target</button>
            </div>
        </div>

        <h2>View Settings</h2>
        <div class="control-group">
            <label>Scale: <span id="scale-val">50</span> px/m</label>
            <input type="range" min="10" max="200" value="50" style="width:100%" oninput="updateScale(this.value)">
        </div>
    </div>

    <div id="dashboard-container">
        <div id="dashboard-grid">
            <div id="empty-msg">No sensors connected.<br>Use sidebar to add a sensor.</div>
        </div>
    </div>

    <script>
        // 상태 변수
        let scale = 50;
        let selectedSensorId = null;
        let isLooping = false;

        function init() {
            isLooping = true;
            loop();
        }

        // --- 센서 추가 ---
        async function addSensor() {
            const ip = document.getElementById('new-ip').value;
            const port = parseInt(document.getElementById('new-port').value);
            
            try {
                const res = await fetch('/connect', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ip, port })
                });
                const data = await res.json();
                if(data.status !== 'connected') {
                    alert('Failed: ' + data.message);
                }
            } catch(e) { alert('Error: ' + e.message); }
        }

        // --- 선택된 센서 연결 해제 ---
        async function disconnectSelected() {
            if(!selectedSensorId) return alert('Select a sensor first.');
            if(!confirm('Disconnect Sensor ID ' + selectedSensorId + '?')) return;
            
            await fetch('/disconnect', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: selectedSensorId })
            });
            
            // 선택 초기화
            selectedSensorId = null;
            document.getElementById('cfg-target-id').innerText = 'None';
        }

        // --- 설정 적용 ---
        async function applyConfig() {
            if(!selectedSensorId) return alert("Select a sensor card to configure.");
            
            const min = parseFloat(document.getElementById('scan-min').value);
            const max = parseFloat(document.getElementById('scan-max').value);
            const btn = document.querySelector('button[onclick="applyConfig()"]');
            
            btn.innerText = "Applying..."; btn.disabled = true;
            try {
                const res = await fetch('/config/scan', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id: selectedSensorId, min, max })
                });
                const data = await res.json();
                alert(data.status === 'success' ? 'Config Applied!' : 'Error: ' + data.message);
            } catch(e) { alert('Network Error'); }
            btn.innerText = "Apply Config"; btn.disabled = false;
        }

        // --- 뷰 제어 ---
        function updateScale(val) {
            scale = parseInt(val);
            document.getElementById('scale-val').innerText = scale;
        }

        function selectSensor(id, ip) {
            selectedSensorId = id;
            document.getElementById('cfg-target-id').innerText = '#' + id + ' (' + ip + ')';
            
            // UI Highlight
            document.querySelectorAll('.sensor-card').forEach(el => el.classList.remove('selected'));
            const card = document.getElementById('card-' + id);
            if(card) card.classList.add('selected');
        }

        // --- 메인 루프 ---
        async function loop() {
            if(!isLooping) return;
            try {
                const res = await fetch('/scan');
                if(res.ok) {
                    const data = await res.json(); // { sensors: [...] }
                    updateDashboard(data.sensors);
                }
            } catch(e) {}
            requestAnimationFrame(loop);
        }

        // --- 대시보드 그리기 ---
        function updateDashboard(sensorList) {
            const grid = document.getElementById('dashboard-grid');
            const emptyMsg = document.getElementById('empty-msg');
            
            if (sensorList.length === 0) {
                emptyMsg.style.display = 'block';
            } else {
                emptyMsg.style.display = 'none';
            }

            // 1. 끊긴 센서 제거
            const activeIds = new Set(sensorList.map(s => s.id));
            document.querySelectorAll('.sensor-card').forEach(card => {
                const id = parseInt(card.dataset.id);
                if (!activeIds.has(id)) {
                    card.remove();
                    if(selectedSensorId === id) {
                        selectedSensorId = null;
                        document.getElementById('cfg-target-id').innerText = 'None';
                    }
                }
            });

            // 2. 센서별 카드 생성 및 업데이트
            sensorList.forEach(sensor => {
                let card = document.getElementById('card-' + sensor.id);
                
                // 카드 없으면 생성
                if (!card) {
                    card = document.createElement('div');
                    card.className = 'sensor-card';
                    card.id = 'card-' + sensor.id;
                    card.dataset.id = sensor.id;
                    card.onclick = () => selectSensor(sensor.id, sensor.ip);
                    
                    card.innerHTML = \`
                        <div class="card-header">
                            <span class="card-title">
                                <div class="status-dot"></div> ID \${sensor.id} (\${sensor.ip})
                            </span>
                            <span style="font-size:0.8rem; color:#aaa">Port: \${sensor.port}</span>
                        </div>
                        <div class="card-body">
                            <canvas width="400" height="400"></canvas>
                        </div>
                        <div class="card-footer">
                            <span id="stat-freq-\${sensor.id}">Freq: - Hz</span>
                            <span id="stat-pts-\${sensor.id}">Pts: -</span>
                        </div>
                    \`;
                    grid.appendChild(card);
                }

                // 데이터 그리기
                if (sensor.data) {
                    document.getElementById('stat-freq-' + sensor.id).innerText = 'Freq: ' + (sensor.data.scanFreq/100).toFixed(1) + ' Hz';
                    document.getElementById('stat-pts-' + sensor.id).innerText = 'Pts: ' + sensor.data.amountOfData;
                    
                    const ctx = card.querySelector('canvas').getContext('2d');
                    drawSensorCanvas(ctx, sensor.data, 400, 400);
                }
            });
        }

        function drawSensorCanvas(ctx, data, w, h) {
            const cx = w / 2;
            const cy = h / 2;

            // 배경
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, w, h);

            // 그리드
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath();
            for (let r = 1; r * scale < cx; r++) {
                ctx.moveTo(cx + r * scale, cy);
                ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
            }
            ctx.moveTo(0, cy); ctx.lineTo(w, cy);
            ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
            ctx.stroke();

            // 점 데이터
            ctx.fillStyle = '#00ff00';
            const startAngle = data.angleBegin / 10000.0;
            const stepAngle = data.angleResol / 10000.0;

            for (let i = 0; i < data.ranges.length; i++) {
                const dist = data.ranges[i];
                if (dist < 0.05) continue;

                const angleDeg = startAngle + (i * stepAngle);
                const rad = ((-angleDeg)) * (Math.PI / 180);

                const x = cx + Math.cos(rad) * dist * scale;
                const y = cy + Math.sin(rad) * dist * scale;

                ctx.fillRect(x, y, 2, 2);
            }
        }

        init();
    </script>
</body>
</html>
`;

// --- 초기화 시퀀스 (업로드된 파일 로직 유지 + 인스턴스화) ---
async function runLogBasedInit(driver: LidarDriver, id: number) {
    console.log(`[Sensor ${id}] Starting Log-Based Init Sequence...`);

    try {
        driver.sendCommand('SensorScanInfo');
        await delay(100);

        driver.sendCommand('LSDIConfig');
        await delay(50);

        driver.sendCommand('LSDOConfig');
        await delay(50);

        driver.sendCommand('LSFConfig');
        await delay(50);

        driver.sendCommand('LSScanDataConfig');
        await delay(100);

        driver.sendCommand('LSTeachingConfig');
        await delay(50);

        console.log(`[Sensor ${id}] Sending Login & Start...`);
        driver.sendCommand('SetAccessLevel,0000');
        await delay(100);
        driver.sendCommand('SensorStart');

        console.log(`[Sensor ${id}] Sequence Completed.`);
    } catch (e) {
        console.error(`[Sensor ${id}] Init Error:`, e);
    }
}

// --- API 라우트 ---

fastify.get('/', async (req, reply) => reply.type('text/html').send(indexHtml));

// 1. 센서 연결 (다중 지원)
fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
    const { ip, port } = request.body;
    const targetPort = port || 8000;

    // 이미 연결된 IP인지 확인
    for (const [sId, ctx] of sensors) {
        if (ctx.ip === ip && ctx.port === targetPort) {
            return { status: 'connected', message: 'Already connected', id: sId };
        }
    }

    try {
        const id = nextSensorId++;
        const driver = new LidarDriver();

        // 새 컨텍스트 생성
        const context: SensorContext = {
            driver,
            data: null,
            ip,
            port: targetPort
        };

        // 데이터 수신 핸들러 등록
        driver.on('scan', (data: ScanData) => {
            context.data = data;
        });

        // 연결 시도
        if (!driver.isConnected()) {
            await driver.connect(ip, targetPort);
            sensors.set(id, context); // 맵에 저장

            // 초기화 실행 (비동기)
            runLogBasedInit(driver, id).catch(err => console.error(`[Sensor ${id}] Init failed:`, err));
        }

        return { status: 'connected', id };
    } catch (err: any) {
        return { status: 'error', message: err.message };
    }
});

// 2. 센서 연결 해제 (ID 기반)
fastify.post<{ Body: { id: number } }>('/disconnect', async (request, reply) => {
    const { id } = request.body;
    const context = sensors.get(id);

    if (context && context.driver.isConnected()) {
        try {
            context.driver.sendCommand('SensorStop');
            setTimeout(() => context.driver.disconnect(), 100);
        } catch (e) { }
    }

    sensors.delete(id); // 목록에서 제거
    return { status: 'disconnected', id };
});

// 3. 전체 센서 데이터 요청
fastify.get('/scan', async (request, reply) => {
    // 맵을 순회하며 모든 센서의 데이터 반환
    const result = [];
    for (const [id, ctx] of sensors) {
        result.push({
            id: id,
            ip: ctx.ip,
            port: ctx.port,
            data: ctx.data
        });
    }
    return { sensors: result };
});

// 4. 스캔 설정 (ID 기반)
fastify.post<{ Body: { id: number; min: number; max: number } }>('/config/scan', async (request, reply) => {
    const { id, min, max } = request.body;
    const context = sensors.get(id);

    if (!context || !context.driver.isConnected()) {
        return { status: 'error', message: 'Sensor not connected or invalid ID' };
    }

    const driver = context.driver;

    try {
        console.log(`[Sensor ${id} Config] Min ${min}° ~ Max ${max}°`);

        console.log(`[Sensor ${id}] 1. SetAccessLevel,0000`);
        driver.sendCommand('SetAccessLevel,0000');
        await delay(100);

        const startVal = Math.round(min * 10000);
        const endVal = Math.round(max * 10000);
        const configCmd = `LSScanDataConfig,${toHex(startVal)},${toHex(endVal)},1,1,1`;

        console.log(`[Sensor ${id}] 2. Sending Config: ${configCmd}`);
        driver.sendCommand(configCmd);
        await delay(200);

        console.log(`[Sensor ${id}] 3. SensorStop`);
        driver.sendCommand('SensorStop');
        await delay(500);

        console.log(`[Sensor ${id}] 4. SensorStart`);
        driver.sendCommand('SensorStart');

        return { status: 'success', command: configCmd };
    } catch (err: any) {
        console.error(err);
        return { status: 'error', message: err.message };
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Server running at http://localhost:3000');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();