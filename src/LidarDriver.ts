import net from 'net';
import { EventEmitter } from 'events';

export interface ScanData {
  scanCounter: number;
  scanFreq: number;
  measFreq: number;
  angleBegin: number;
  angleResol: number;
  amountOfData: number;
  ranges: number[];
  rssi: number[];
}

export class LidarDriver extends EventEmitter {
  private client: net.Socket;
  private connected: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  // 프로토콜 상수
  private readonly STX = 0x02;
  private readonly ETX = 0x03;

  constructor() {
    super();
    this.client = new net.Socket();

    this.client.on('data', (data) => this.handleData(data as Buffer));
    this.client.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      console.log('Lidar disconnected');
    });
    this.client.on('error', (err) => {
      console.error('Lidar Socket Error:', err);
      this.emit('error', err);
    });
  }

  public connect(host: string, port: number = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.connect(port, host, () => {
        this.connected = true;
        console.log(`Connected to Lidar at ${host}:${port}`);
        resolve();
      });
      this.client.on('error', (err) => reject(err));
    });
  }

  public disconnect() {
    this.client.destroy();
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * C++ autolidar.cpp의 makeCommand 로직 구현
   * Format: STX + Length(4bytes Hex) + , + Type + , + Command + ... + ETX
   */
  public sendCommand(rawCmd: string) {
    if (!this.connected) return;

    // 1. 커맨드 타입 결정 (C++ 코드 매핑)
    let type = 'sMC'; // 기본값 (Method Command)
    if (rawCmd.includes('SensorScanInfo') || rawCmd.includes('ScanDataConfig')) {
        type = 'sRC'; // Read Command
    } else if (rawCmd.includes('LSScanDataConfig')) {
        type = 'sWC'; // Write Command
    }

    // 2. 페이로드 구성
    const payloadStr = `,${type},${rawCmd}`;

    // 3. 전체 길이 계산 (STX + Length4 + Payload + ETX)
    const totalLen = 1 + 4 + payloadStr.length + 1;
    
    // 4. 길이 필드 (4자리 16진수, 대문자)
    const lenStr = totalLen.toString(16).toUpperCase().padStart(4, '0');

    // 5. 최종 패킷 생성
    const packetStr = `${lenStr}${payloadStr}`;
    const packetBuf = Buffer.alloc(1 + packetStr.length + 1);
    
    packetBuf[0] = this.STX;
    packetBuf.write(packetStr, 1);
    packetBuf[packetBuf.length - 1] = this.ETX;

    console.log(`Sending: ${packetStr}`);
    this.client.write(packetBuf);
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    let stxIndex = this.buffer.indexOf(this.STX);
    while (stxIndex !== -1) {
      const etxIndex = this.buffer.indexOf(this.ETX, stxIndex);
      
      if (etxIndex !== -1) {
        const packet = this.buffer.subarray(stxIndex + 1, etxIndex);
        this.parsePacket(packet);
        this.buffer = this.buffer.subarray(etxIndex + 1);
        stxIndex = this.buffer.indexOf(this.STX);
      } else {
        break;
      }
    }
  }

  private parsePacket(packet: Buffer) {
    const msg = packet.toString('ascii');
    const fields = msg.split(',');

    // 스캔 데이터 패킷 식별
    if (fields.includes('ScanData') || fields.includes('sRA') || fields.includes('sSN')) { 
        if (msg.includes('DIST1')) {
             try {
                const scanData = this.parseScanData(fields);
                this.emit('scan', scanData);
            } catch (e) {
                console.error('Parsing error:', e);
            }
        }
    } else {
        // 기타 응답 로그 (로그인 성공 여부 등 확인용)
        console.log('Lidar Response:', msg);
    }
  }

  private parseScanData(fields: string[]): ScanData {
    // "DIST1" 키워드 위치를 기준으로 데이터 파싱 (가변 길이에 안전함)
    const distIndex = fields.indexOf('DIST1');
    if (distIndex === -1) throw new Error('No DIST1 field');

    // 헤더 정보 파싱 (16진수)
    // C++ 코드 구조: ... [ScanCounter],[ScanFreq],[MeasFreq],[AngleBegin],[AngleResol],[Amount],DIST1 ...
    const scanCounter = parseInt(fields[distIndex - 9], 16);
    const scanFreq = parseInt(fields[distIndex - 6], 16);
    const measFreq = parseInt(fields[distIndex - 5], 16);
    
    // [중요] 각도는 부호있는 16진수(Int32)일 수 있으므로 Uint->Int 변환 고려
    // 하지만 JS parseInt는 부호를 직접 처리하지 않으므로 32비트 변환
    let angleBegin = parseInt(fields[distIndex - 4], 16);
    if (angleBegin > 0x7FFFFFFF) angleBegin -= 0xFFFFFFFF + 1;

    const angleResol = parseInt(fields[distIndex - 3], 16);
    const amountOfData = parseInt(fields[distIndex - 2], 16);

    const result: ScanData = {
      scanCounter, scanFreq, measFreq, angleBegin, angleResol, amountOfData,
      ranges: [], rssi: []
    };

    // 거리 데이터 파싱 (mm -> m 변환)
    let idx = distIndex + 1;
    for (let i = 0; i < amountOfData; i++) {
      if (idx >= fields.length) break;
      const distMm = parseInt(fields[idx++], 16);
      result.ranges.push(distMm / 1000.0);
    }
    
    return result;
  }
}