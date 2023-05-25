import { hexlify } from '@ethersproject/bytes'
import { keccak256 } from '@ethersproject/solidity'
import { toUtf8Bytes } from '@ethersproject/strings'

import { ZqField } from 'ffjavascript'

import poseidon from 'poseidon-lite'

/*
  This is the "Baby Jubjub" curve described here:
  https://iden3-docs.readthedocs.io/en/latest/_downloads/33717d75ab84e11313cc0d8a090b636f/Baby-Jubjub.pdf
*/
export const SNARK_FIELD_SIZE = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

// Creates the finite field
export const Fq = new ZqField(SNARK_FIELD_SIZE)


export function calculateExternalNullifier(epoch: bigint, rlnIdentifier: bigint): bigint {
  return poseidon([epoch, rlnIdentifier])
}


/**
 * Hashes a signal string with Keccak256.
 * @param signal The RLN signal.
 * @returns The signal hash.
 */
export function calculateSignalHash(signal: string): bigint {
  const converted = hexlify(toUtf8Bytes(signal))
  return BigInt(keccak256(['bytes'], [converted])) >> BigInt(8)
}


/**
 * Recovers secret from two shares
 * @param x1 signal hash of first message
 * @param x2 signal hash of second message
 * @param y1 yshare of first message
 * @param y2 yshare of second message
 * @returns identity secret
 */
export function shamirRecovery(x1: bigint, x2: bigint, y1: bigint, y2: bigint): bigint {
  const slope = Fq.div(Fq.sub(y2, y1), Fq.sub(x2, x1))
  const privateKey = Fq.sub(y1, Fq.mul(slope, x1))

  return Fq.normalize(privateKey)
}

