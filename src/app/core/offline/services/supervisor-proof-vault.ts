import { Injectable } from '@angular/core';

interface SupervisorProof {
  readonly value: unknown;
  readonly expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class SupervisorProofVault {
  private readonly proofs = new Map<string, SupervisorProof>();

  attach(ownerId: string, localId: string, value: unknown, expiresAt: Date): void {
    const key = this.key(ownerId, localId);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('A prova efêmera de supervisor possui validade inválida.');
    }
    this.proofs.set(key, { value, expiresAt: expiresAt.getTime() });
  }

  read(ownerId: string, localId: string): unknown | null {
    const key = this.key(ownerId, localId);
    const proof = this.proofs.get(key);
    if (!proof || proof.expiresAt <= Date.now()) {
      this.proofs.delete(key);
      return null;
    }
    return proof.value;
  }

  clear(ownerId: string, localId: string): void {
    this.proofs.delete(this.key(ownerId, localId));
  }

  clearAll(): void {
    this.proofs.clear();
  }

  private key(ownerId: string, localId: string): string {
    const owner = ownerId.trim();
    const local = localId.trim();
    if (!owner || !local) {
      throw new Error('Owner e registro local são obrigatórios para a prova efêmera.');
    }
    return `${owner}\u0000${local}`;
  }
}
