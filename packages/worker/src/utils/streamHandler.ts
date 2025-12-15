import { EventEmitter } from 'events';

export class StreamHandler extends EventEmitter {
  private buffer: string = '';

  append(data: string): void {
    this.buffer += data;
    this.emit('data', data);
  }

  getBuffer(): string {
    return this.buffer;
  }

  clear(): void {
    this.buffer = '';
  }
}

