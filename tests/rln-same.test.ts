import { Identity } from '@semaphore-protocol/identity'
import { Registry, RLNSame, RLNSameFullProof  } from "../src"
import { DEFAULT_REGISTRY_TREE_DEPTH } from '../src/registry'
import { rlnInstanceFactory, fieldFactory } from './factories'
import { defaultParamsPath } from "./configs";
import { DEFAULT_MESSAGE_LIMIT } from '../src/rln-same';
import poseidon from 'poseidon-lite';
import { Fq } from '../src/utils';
import { calculateExternalNullifier, calculateSignalHash, shamirRecovery } from '../src/common';


const defaultTreeDepth = DEFAULT_REGISTRY_TREE_DEPTH;

jest.setTimeout(60000)

// TODO: Add tests for RLN Identifier

describe("RLNSame", () => {
  const identityCommitments: bigint[] = []
  const paramsPath = defaultParamsPath
  const rlnInstance = rlnInstanceFactory(paramsPath, undefined)
  // Same parameter, same rln identifier, but different identity
  const rlnInstance2 = rlnInstanceFactory(paramsPath, rlnInstance.rlnIdentifier)

  beforeAll(() => {
    // Gen random identities
    const numberOfLeaves = 3
    for (let i = 0; i < numberOfLeaves; i += 1) {
      const identity = new Identity()
      const identityCommitment = identity.getCommitment()

      identityCommitments.push(identityCommitment)
    }
  })

  describe("RLNSame functionalities", () => {
    test("Should retrieve user secret using shamirRecovery", () => {
      const signal1 = "hey hey"
      const signalHash1 = calculateSignalHash(signal1)
      const signal2 = "hey hey again"
      const signalHash2 = calculateSignalHash(signal2)

      const messageId = BigInt(1)
      const epoch = fieldFactory()

      function calculateY(
        x: bigint,
      ): bigint {
        const externalNullifier = calculateExternalNullifier(epoch, rlnInstance.rlnIdentifier)
        const a1 = poseidon([rlnInstance.secretIdentity, externalNullifier, messageId])
        // y = identitySecret + a1 * x
        return Fq.normalize(rlnInstance.secretIdentity + a1 * x)
      }

      const y1 = calculateY(signalHash1)
      const y2 = calculateY(signalHash2)

      const retrievedSecret = shamirRecovery(signalHash1, signalHash2, y1, y2)

      expect(retrievedSecret).toEqual(rlnInstance.secretIdentity)
    })

    test("Should generate and verify RLNSame proof", async () => {
      const leaves = Object.assign([], identityCommitments)
      leaves.push(rlnInstance.commitment)

      const signal = "hey hey"
      const epoch = fieldFactory()
      const merkleProof = Registry.generateMerkleProof(defaultTreeDepth, BigInt(0), leaves, rlnInstance.commitment)
      // Test: succeeds with valid inputs
      const messageId = BigInt(0)
      // Sanity check that messageId is within range and thus valid
      expect(messageId).toBeLessThanOrEqual(DEFAULT_MESSAGE_LIMIT)
      const fullProof = await rlnInstance.generateProof(signal, merkleProof, messageId, epoch)
      expect(await rlnInstance.verifyProof(fullProof)).toBe(true)

      // Test: generateProof fails with invalid messageId
      const invalidMessageIds = [DEFAULT_MESSAGE_LIMIT, DEFAULT_MESSAGE_LIMIT + 1]
      for (const id of invalidMessageIds) {
        expect(async () => {
          await rlnInstance.generateProof(signal, merkleProof, id, epoch)
        }).rejects.toThrowError("messageId must be in the range")
      }

      const rlnInstanceAnother = rlnInstanceFactory(paramsPath, rlnInstance.rlnIdentifier, BigInt(DEFAULT_MESSAGE_LIMIT))
      // Test: proof from rlnInstance should be verifiable by rlnInstanceAnother since they
      // use the same parameters (paramsPath, rlnIdentifier, and messageLimit)
      expect(await rlnInstanceAnother.verifyProof(fullProof)).toBe(true)
      // Test: rlnInstanceAnother should fail to verify proof now since messageLimit is different
      rlnInstanceAnother.messageLimit = BigInt(DEFAULT_MESSAGE_LIMIT + 1)
      expect(async () => {
        await rlnInstanceAnother.verifyProof(fullProof)
      }).rejects.toThrowError('Message limit does not match')
    }, 30000)

    test("Should retrieve user secret using full proofs", async () => {
      const leaves = Object.assign([], identityCommitments)
      leaves.push(rlnInstance.commitment)

      const signal1 = "hey hey"
      const signal2 = "hey hey hey"

      const epoch1 = fieldFactory()
      const epoch2 = fieldFactory([epoch1])
      const merkleProof = Registry.generateMerkleProof(defaultTreeDepth, BigInt(0), leaves, rlnInstance.commitment)

      leaves.push(rlnInstance2.commitment)
      const merkleProof2 = Registry.generateMerkleProof(defaultTreeDepth, BigInt(0), leaves, rlnInstance2.commitment)

      const messageId = 1
      const proof = await rlnInstance.generateProof(signal1, merkleProof, messageId, epoch1)
      // Test: another signal in the same epoch, messageId, and identity. Breached
      const proofDiffSignal = await rlnInstance.generateProof(signal2, merkleProof, messageId, epoch1)
      const retrievedSecret1 = RLNSame.retrieveSecret(proof, proofDiffSignal)
      expect(retrievedSecret1).toEqual(rlnInstance.secretIdentity)

      // Test: messageId is different and thus there is no breach. retrieveSecret is expected to fail
      const anotherMessageId = messageId + 1
      const proofDiffMessageId = await rlnInstance.generateProof(signal1, merkleProof, anotherMessageId, epoch1)
      expect(
        () => RLNSame.retrieveSecret(proof, proofDiffMessageId)
      ).toThrow("Internal Nullifiers do not match! Cannot recover secret.")

      // Test: epoch is different and there is no breach. retrieveSecret is expected to fail
      const proofDiffEpoch = await rlnInstance.generateProof(signal1, merkleProof, messageId, epoch2)
      expect(
        () => RLNSame.retrieveSecret(proof, proofDiffEpoch)
      ).toThrow("External Nullifiers do not match! Cannot recover secret.")

      // Test: inputs are the same as proof but it's from different identity.
      // There is no breach and retrieveSecret is expected to fail
      const proofDiffIdentity = await rlnInstance2.generateProof(signal1, merkleProof2, messageId, epoch1)
      expect(
        () => RLNSame.retrieveSecret(proof, proofDiffIdentity)
      ).toThrow("Internal Nullifiers do not match! Cannot recover secret.")

      // Test: retrieveSecret fails with invalid public inputs
      // 1. wrong epoch
      const proofDiffPublicInputEpoch: RLNSameFullProof = {
        epoch: fieldFactory([proof.epoch]),
        rlnIdentifier: proof.rlnIdentifier,
        snarkProof: proof.snarkProof,
      }
      expect(
        () => RLNSame.retrieveSecret(proof, proofDiffPublicInputEpoch)
      ).toThrow("External Nullifiers do not match! Cannot recover secret.")

      // 2. wrong rln identifier
      const proofDiffPublicInputRLNIdentifier: RLNSameFullProof = {
        epoch: proof.epoch,
        rlnIdentifier: fieldFactory([proof.rlnIdentifier]),
        snarkProof: proof.snarkProof,
      }
      expect(
        () => RLNSame.retrieveSecret(proof, proofDiffPublicInputRLNIdentifier)
      ).toThrow("External Nullifiers do not match! Cannot recover secret.")
    })

    test("Should export/import to json", () => {
      const rlnInstanceJson = rlnInstance.export();
      const rlnInstanceFromJson = RLNSame.import(rlnInstanceJson);
      expect(rlnInstanceFromJson.identity.commitment).toEqual(rlnInstance.identity.commitment);
      expect(rlnInstanceFromJson.rlnIdentifier).toEqual(rlnInstance.rlnIdentifier);
      expect(rlnInstanceFromJson.wasmFilePath).toEqual(rlnInstance.wasmFilePath);
      expect(rlnInstanceFromJson.finalZkeyPath).toEqual(rlnInstance.finalZkeyPath);
      expect(rlnInstanceFromJson.verificationKey).toEqual(rlnInstance.verificationKey);
    })
  })
})
