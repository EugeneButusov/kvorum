import { Injectable } from '@nestjs/common';

export interface Drainable {
  drain(): Promise<void>;
}

@Injectable()
export class DrainableRegistry {
  private readonly members: Drainable[] = [];

  register(d: Drainable): void {
    this.members.push(d);
  }

  async drainAll(): Promise<void> {
    await Promise.allSettled(this.members.map((d) => d.drain()));
  }
}
