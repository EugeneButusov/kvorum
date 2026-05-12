// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Minimal test fixture that emits Compound Governor-compatible events.
 * Used by F3a (full-pipeline reorg integration test) and F3b (DLQ fault-injection test).
 *
 * Compilation: solc 0.8.26, optimizer enabled.
 * See README.md for the regeneration recipe.
 * Compiled output is checked in as compound-emitter.bytecode.ts — no Solidity toolchain in CI.
 */
contract CompoundEmitter {
    event ProposalCreated(
        uint256 id,
        address proposer,
        address[] targets,
        uint256[] values,
        string[] signatures,
        bytes[] calldatas,
        uint256 startBlock,
        uint256 endBlock,
        string description
    );

    /**
     * Emits a valid, fully ABI-encoded ProposalCreated log.
     * Decoded successfully by decodeCompoundLog → archive writer.
     */
    function emitValid() external {
        address[] memory targets = new address[](1);
        targets[0] = address(0x02);
        uint256[] memory values = new uint256[](1); // [0]
        string[] memory sigs = new string[](1); // ['']
        bytes[] memory calls = new bytes[](1); // ['0x']
        emit ProposalCreated(1, address(0x01), targets, values, sigs, calls, 100, 200, "");
    }

    /**
     * Emits a log with the ProposalCreated topic but a truncated 8-byte data buffer.
     * ethers' AbiCoder throws BUFFER_OVERRUN; decodeCompoundLog wraps as
     * DecodeError(reason='parse_failed') → routed to ingestion_dlq with stage='archive_decode'.
     */
    function emitMalformed() external {
        bytes32 topic0 = 0x7d84a6263ae0d98d3329bd7b46bb4e8d6f98cd35a7adb45c274c8b7fd5ebd5e0;
        assembly {
            let p := mload(0x40)
            mstore(p, 0) // 8 bytes of zeros (definitely too short to decode)
            log1(p, 8, topic0)
        }
    }
}
