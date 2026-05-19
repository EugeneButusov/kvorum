// The EVM test emitter emits events with PROPOSAL_CREATED_TOPIC (keccak256 of
// ProposalCreated). Bytecode is shared with CompoundEmitter.sol — the topic
// hash is identical, so the same compiled contract serves both compound tests
// and generic infrastructure tests.
export {
  COMPOUND_EMITTER_DEPLOY_BYTECODE as EVM_TEST_EMITTER_DEPLOY_BYTECODE,
  EMIT_VALID_SELECTOR,
  EMIT_MALFORMED_SELECTOR,
  PROPOSAL_CREATED_TOPIC,
} from './compound-emitter.bytecode';
