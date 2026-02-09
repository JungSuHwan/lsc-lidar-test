import net from 'net';

// --- 설정 및 상수 ---
const STX = 0x02;
const ETX = 0x03;

// --- 시뮬레이션 환경 설정 ---
// 방 크기 (미터)
const ROOM_SIZE = 10.0; 
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
        minAngle: -135, // 270도 커버
        maxAngle: 135,
        resolution: 0.5
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
        socket.on('error', () => {});
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
                // 설정 변경 로직 (생략 가능하나 유지)
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

    // --- 핵심 로직: 가상 환경 Ray Casting ---
    private broadcastScanData() {
        if (this.sockets.length === 0) return;

        this.scanCounter++;
        const ranges: string[] = [];
        
        // 1. 센서의 현재 설정
        const startDeg = this.config.minAngle;
        const endDeg = this.config.maxAngle;
        const step = this.config.resolution;
        const count = Math.floor((endDeg - startDeg) / step) + 1;

        // 2. 가상 장애물 위치 계산 (전역적으로 빙글빙글 도는 물체)
        const objX = Math.cos(globalPhase) * 3.0; // 반경 3m 원운동
        const objY = Math.sin(globalPhase) * 3.0;
        const objRadius = 0.5; // 물체 크기

        // 3. 레이저 발사
        for (let i = 0; i < count; i++) {
            // A. 현재 레이저의 로컬 각도
            const localAngle = startDeg + (i * step);
            
            // B. 전역 각도 (Global Ray Angle) = 센서 설치각도 + 레이저 각도
            // (이 부분이 시뮬레이션의 핵심입니다!)
            const globalRayDeg = this.pose.rotation + localAngle;
            const globalRayRad = globalRayDeg * (Math.PI / 180);

            // C. 레이저 시작점 (센서의 전역 위치)
            const sx = this.pose.x;
            const sy = this.pose.y;

            // D. Ray Casting: 방 벽과의 교차점 찾기 (Sqaure Room)
            // 방은 (-5, -5) ~ (5, 5) 범위라고 가정 (10m x 10m)
            const wallLimit = ROOM_SIZE / 2;
            let dist = 20.0; // 최대 거리

            const cos = Math.cos(globalRayRad);
            const sin = Math.sin(globalRayRad);

            // 수직 벽 (X = ±5) 검사
            if (cos !== 0) {
                const xTarget = cos > 0 ? wallLimit : -wallLimit;
                const d = (xTarget - sx) / cos;
                if (d > 0) dist = Math.min(dist, d);
            }
            // 수평 벽 (Y = ±5) 검사
            if (sin !== 0) {
                const yTarget = sin > 0 ? wallLimit : -wallLimit;
                const d = (yTarget - sy) / sin;
                if (d > 0) dist = Math.min(dist, d);
            }

            // E. 움직이는 원형 장애물 검사
            // (간단한 Ray-Circle Intersection 근사치)
            // 벡터 V = Object - Sensor
            const vx = objX - sx;
            const vy = objY - sy;
            // 투영 (Projection)
            const proj = vx * cos + vy * sin;
            
            if (proj > 0 && proj < dist) {
                // 레이저 선상에서 물체 중심까지의 수직 거리
                const distToRay = Math.abs(vx * -sin + vy * cos);
                if (distToRay < objRadius) {
                    // 물체에 맞음!
                    dist = proj - Math.sqrt(objRadius*objRadius - distToRay*distToRay);
                }
            }

            // F. 노이즈 추가 및 저장
            dist += (Math.random() - 0.5) * 0.02; // 2cm 노이즈
            if (dist < 0) dist = 0;
            
            ranges.push(toHex(Math.round(dist * 1000))); // m -> mm
        }

        // 헤더 생성 및 전송 (기존과 동일)
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