export interface Lease {
  readonly name: string;
  release(): Promise<void>;
}

export interface LeaseManager {
  tryAcquire(name: string): Promise<Lease | null>;
}

