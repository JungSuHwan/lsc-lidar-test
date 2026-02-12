import net from 'net';

// --- 설정 및 상수 ---
const STX = 0x02;
const ETX = 0x03;

// --- 시뮬레이션 환경 설정 ---
// 방 크기 (미터)
const ROOM_SIZE = 20.0;
// 움직이는 장애물 속도
let globalPhase = 0;

// 센서 배치 설정 (로봇 중심 기준)
interface SensorPose {
    port: number;
    x: number;      // 로봇 중심에서의 X 위치 (m)
    y: number;      // 로봇 중심에서의 Y 위치 (m)
    rotation: number; // 설치 각도 (도)
}

const SENSOR_CONFIGS: SensorPose[] = [
    { port: 8001, x: 0.5, y: 0.0, rotation: 0 },    // [Front] 앞
    { port: 8002, x: 0.0, y: -0.5, rotation: -90 }, // [Right] 오른쪽
    { port: 8003, x: -0.5, y: 0.0, rotation: 180 }, // [Back] 뒤
    { port: 8004, x: 0.0, y: 0.5, rotation: 90 }    // [Left] 왼쪽
];

// --- 헬퍼 함수 ---
function toHex(num: number, padding: number = 8): string {
    const unsigned = num < 0 ? (num >>> 0) : num;
    return unsigned.toString(16).toUpperCase().padStart(padding, '0');
}

function createPacket(payload: string): Buffer {
    const fullPayload = `,${payload}`;
    const len = fullPayload.length + 1;
    const lenStr = len.toString(16).toUpperCase().padStart(4, '0');
    const packetStr = `${lenStr}${fullPayload}`;
    const buffer = Buffer.alloc(1 + packetStr.length + 1);
    buffer[0] = STX;
    buffer.write(packetStr, 1);
    buffer[buffer.length - 1] = ETX;
    return buffer;
}

// --- 시뮬레이터 클래스 ---
class LidarSimulator {
    private server: net.Server;
    private sockets: net.Socket[] = [];
    private scanInterval: NodeJS.Timeout | null = null;

    // 센서 고유 설정
    private port: number;
    private pose: SensorPose;

    private scanCounter = 0;

    // 스캔 설정 (기본값)
    private config = {
        minAngle: -45,  // 시작 각도 변경 (-135 -> -45)
        maxAngle: 225,  // 종료 각도 변경 (135 -> 225)
        resolution: 0.333 // 분해능 변경 (0.5 -> 0.333)
    };

    constructor(pose: SensorPose) {
        this.port = pose.port;
        this.pose = pose; // 내 위치와 각도 기억

        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.listen(this.port, () => {
            console.log(`[Sim ${this.port}] Robot Sensor at (x:${pose.x}, y:${pose.y}, th:${pose.rotation}°)`);
        });
    }

    private handleConnection(socket: net.Socket) {
        this.sockets.push(socket);
        let buffer = Buffer.alloc(0);

        socket.on('data', (data: Buffer) => {
            buffer = Buffer.concat([buffer, data]);
            let stxIdx = buffer.indexOf(STX);
            while (stxIdx !== -1) {
                const etxIdx = buffer.indexOf(ETX, stxIdx);
                if (etxIdx !== -1) {
                    const packet = buffer.subarray(stxIdx + 1, etxIdx);
                    this.processCommand(socket, packet);
                    buffer = buffer.subarray(etxIdx + 1);
                    stxIdx = buffer.indexOf(STX);
                } else { break; }
            }
        });

        socket.on('close', () => {
            this.sockets = this.sockets.filter(s => s !== socket);
            if (this.sockets.length === 0) this.stopScanning();
        });
        socket.on('error', () => { });
    }

    private processCommand(socket: net.Socket, packet: Buffer) {
        const msg = packet.subarray(4).toString('ascii');
        const parts = msg.split(',');
        const command = parts[2];

        if (command === 'SensorStart') {
            this.startScanning();
            socket.write(createPacket(`sRA,SensorStart,1`));
        }
        else if (command === 'SensorStop') {
            this.stopScanning();
            socket.write(createPacket(`sRA,SensorStop,1`));
        }
        else if (command === 'LSScanDataConfig') {
            if (parts[1] === 'sWC') {
                // 클라이언트가 보낸 각도 설정을 실제로 적용
                // 패킷 구조: ,sWC,LSScanDataConfig,{startAngleHex},{endAngleHex},1,1,1
                // parts[0] = '' (앞 콤마), parts[1] = 'sWC', parts[2] = 'LSScanDataConfig'
                // parts[3] = startAngle (hex, 10000배), parts[4] = endAngle (hex, 10000배)
                if (parts.length >= 5) {
                    let startAngleRaw = parseInt(parts[3], 16);
                    let endAngleRaw = parseInt(parts[4], 16);

                    // 부호 있는 32비트 정수 변환 (음수 각도 지원, 예: -45°)
                    if (startAngleRaw > 0x7FFFFFFF) startAngleRaw -= 0xFFFFFFFF + 1;
                    if (endAngleRaw > 0x7FFFFFFF) endAngleRaw -= 0xFFFFFFFF + 1;

                    const newMinAngle = startAngleRaw / 10000;
                    const newMaxAngle = endAngleRaw / 10000;

                    console.log(`[Sim ${this.port}] Scan range updated: ${this.config.minAngle}°~${this.config.maxAngle}° → ${newMinAngle}°~${newMaxAngle}°`);
                    this.config.minAngle = newMinAngle;
                    this.config.maxAngle = newMaxAngle;
                }
            }
            socket.write(createPacket(`sWA,LSScanDataConfig,1`));
        }
        else {
            socket.write(createPacket(`sRA,${command},1`));
        }
    }

    private startScanning() {
        if (this.scanInterval) return;
        // 모든 센서가 동기화된 애니메이션을 위해 전역 변수 사용 권장
        this.scanInterval = setInterval(() => this.broadcastScanData(), 50);
    }

    private stopScanning() {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
    }

    // --- 핵심 로직: 환경을 센서 로컬 좌표계로 변환 후 Ray Casting ---
    private broadcastScanData() {
        if (this.sockets.length === 0) return;

        this.scanCounter++;
        const ranges: string[] = [];

        // 1. 센서의 현재 설정
        const startDeg = this.config.minAngle;
        const endDeg = this.config.maxAngle;
        const step = this.config.resolution;
        const count = Math.floor((endDeg - startDeg) / step) + 1;

        // 2. 환경을 센서 로컬 좌표계로 변환
        //    (실제 센서처럼 rotation을 모르는 상태에서 Ray Casting)
        const sx = this.pose.x;
        const sy = this.pose.y;
        const rotRad = this.pose.rotation * (Math.PI / 180);
        const cosR = Math.cos(-rotRad);
        const sinR = Math.sin(-rotRad);

        // 글로벌 좌표 → 센서 로컬 좌표 변환 함수
        const toLocal = (gx: number, gy: number) => ({
            x: (gx - sx) * cosR - (gy - sy) * sinR,
            y: (gx - sx) * sinR + (gy - sy) * cosR
        });

        // 3. 장애물을 로컬 좌표로 변환
        const objLocal = toLocal(
            Math.cos(globalPhase) * 3.0,  // 반경 3m 원운동
            Math.sin(globalPhase) * 3.0
        );
        const objRadius = 0.5;

        // 4. 벽 세그먼트를 로컬 좌표로 변환
        const wl = ROOM_SIZE / 2;
        const walls = [
            { a: toLocal(-wl, wl), b: toLocal(wl, wl) },  // Top
            { a: toLocal(-wl, -wl), b: toLocal(wl, -wl) },  // Bottom
            { a: toLocal(-wl, -wl), b: toLocal(-wl, wl) },  // Left
            { a: toLocal(wl, -wl), b: toLocal(wl, wl) },  // Right
        ];

        // 5. 레이저 발사 (로컬 각도만 사용, rotation 미적용!)
        for (let i = 0; i < count; i++) {
            const localAngle = startDeg + (i * step);
            const localRad = localAngle * (Math.PI / 180);

            let dist = 25.0; // 최대 감지 거리

            const cos = Math.cos(localRad);
            const sin = Math.sin(localRad);

            // A. 벽과의 교차 검사 (Ray-Segment Intersection)
            //    Ray: 원점(0,0) → 방향(cos, sin)
            //    Segment: A(x1,y1) → B(x2,y2)
            for (const wall of walls) {
                const dx = wall.b.x - wall.a.x;
                const dy = wall.b.y - wall.a.y;
                const denom = sin * dx - cos * dy;
                if (Math.abs(denom) < 1e-10) continue; // 평행
                const t = (wall.a.y * dx - wall.a.x * dy) / denom;
                const s = (cos * wall.a.y - sin * wall.a.x) / denom;
                if (t > 0 && s >= 0 && s <= 1) {
                    dist = Math.min(dist, t);
                }
            }

            // B. 장애물과의 교차 검사 (Ray-Circle Intersection)
            const vx = objLocal.x;
            const vy = objLocal.y;
            const proj = vx * cos + vy * sin;

            if (proj > 0 && proj < dist) {
                const distToRay = Math.abs(vx * -sin + vy * cos);
                if (distToRay < objRadius) {
                    dist = proj - Math.sqrt(objRadius * objRadius - distToRay * distToRay);
                }
            }

            // C. 노이즈 추가 및 저장
            dist += (Math.random() - 0.5) * 0.02; // 2cm 노이즈
            if (dist < 0) dist = 0;

            ranges.push(toHex(Math.round(dist * 1000))); // m -> mm
        }

        // 헤더 생성 및 전송
        const headerParts = [
            'sSN', 'LidarData', 'SimDevice', 'v1.0', 'OK',
            toHex(this.scanCounter), '00', '00',
            toHex(2000), toHex(5400),
            toHex(Math.round(this.config.minAngle * 10000)),
            toHex(Math.round(this.config.resolution * 10000)),
            toHex(ranges.length), '00', 'DIST1'
        ];

        const payload = headerParts.join(',') + ',' + ranges.join(',');
        const packet = createPacket(payload);
        this.sockets.forEach(s => s.write(packet));
    }
}

// --- 메인 루프 (전역 애니메이션 타이머) ---
setInterval(() => {
    globalPhase += 0.05; // 물체를 천천히 회전시킴
}, 50);

console.log('--- Multi-Sensor Robot Simulator Starting ---');
console.log(`Environment: ${ROOM_SIZE}m x ${ROOM_SIZE}m Square Room`);

// 설정된 센서들을 생성
SENSOR_CONFIGS.forEach(config => {
    new LidarSimulator(config);
});