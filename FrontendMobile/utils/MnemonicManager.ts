import * as bip39 from 'bip39';
import forge from 'node-forge';
import { Buffer } from 'buffer';

/**
 * MnemonicManager handles BIP-39 mnemonic generation and seed derivation.
 * It ensures the recovery phrase is converted into a high-entropy 256-bit MasterKey.
 */

export class MnemonicManager {
  /**
   * Generates a random 12-word recovery phrase.
   */
  static generateMnemonic(): string {
    return bip39.generateMnemonic(128); // 128 bits of entropy = 12 words
  }

  /**
   * Derives a 256-bit MasterKey from the mnemonic phrase.
   * This is the "Key Equivalence" logic: the phrase replaces the password.
   */
  static async deriveMasterKey(mnemonic: string): Promise<Uint8Array> {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // 1. Generate the 512-bit seed from the mnemonic (no salt for simplicity, or use 'prama-recovery')
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    // 2. Hash the seed down to 256 bits (32 bytes) to use as an AES-GCM MasterKey
    const md = forge.md.sha256.create();
    md.update(seed.toString('binary'));
    const hash = md.digest().getBytes();

    // Convert to Uint8Array for compatibility with our crypto utilities
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      result[i] = hash.charCodeAt(i);
    }
    
    return result;
  }

  /**
   * Validates a 12-word mnemonic phrase.
   */
  static validate(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic.trim());
  }
}
