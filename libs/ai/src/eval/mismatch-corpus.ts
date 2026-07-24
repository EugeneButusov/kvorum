import type { MismatchAnalysis } from '../schemas/mismatch-analysis.js';

export type DiscrepancyType = MismatchAnalysis['discrepancies'][number]['type'];

/** The fields `serializeDecodedActions` projects — the only ones the mismatch input renders/hashes.
 *  A standalone shape (not `Pick<ProposalAction>`) so the corpus stays free of the @libs/db import,
 *  which the tsx eval runner cannot resolve. Structurally compatible with `ProposalAction`. */
export interface CorpusAction {
  action_index: number;
  target_address: string;
  target_chain_id: string;
  value_wei: string;
  function_signature: string | null;
  decoded_function: string | null;
  decoded_arguments: unknown | null;
}

/**
 * One labeled validation case for the mismatch detector (SPEC §5.6 AC #5). `should_flag` is what
 * `mismatchFlag()` must decide; `seeded_discrepancy_types` (on the intentionally-discrepant cases)
 * are the discrepancy kinds the model is expected to surface. Real historical proposals can be added
 * with the same shape.
 */
export interface MismatchCorpusCase {
  id: string;
  dao: 'compound' | 'aave' | 'lido';
  description: string;
  decoded_actions: CorpusAction[];
  expected: {
    should_flag: boolean;
    seeded_discrepancy_types?: DiscrepancyType[];
    notes: string;
  };
}

function action(over: Partial<CorpusAction> & Pick<CorpusAction, 'action_index'>): CorpusAction {
  return {
    target_address: '0x' + '1'.repeat(40),
    target_chain_id: '1',
    value_wei: '0',
    function_signature: null,
    decoded_function: null,
    decoded_arguments: null,
    ...over,
  };
}

// ~20 labeled cases. Realistic but synthetic — real historical proposals can be dropped in with the
// same shape (see plan-m5-3.3 / ADR-080). Roughly half are consistent (to exercise the false-positive
// gate), the rest carry one seeded discrepancy each, plus a few deliberately-vague low-confidence
// cases the detector must NOT surface.
export const MISMATCH_CORPUS: MismatchCorpusCase[] = [
  // ── Consistent (must NOT flag) ─────────────────────────────────────────────
  {
    id: 'compound-reserve-factor-reformatting',
    dao: 'compound',
    description:
      'Raise the reserve factor for the cUSDC market from 10% to 15%. This increases the protocol reserves that accrue from borrower interest.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0xc3d688b66703497daa19211eedff47f25384cdc3',
        function_signature: '_setReserveFactor(uint256)',
        decoded_function: '_setReserveFactor',
        decoded_arguments: { newReserveFactorMantissa: '150000000000000000' },
      }),
    ],
    expected: { should_flag: false, notes: '15% == 1.5e17 in 18-decimal mantissa; prose matches.' },
  },
  {
    id: 'aave-treasury-transfer-consistent',
    dao: 'aave',
    description:
      'Transfer 500,000 USDC from the Aave Collector to the grants multisig 0x1234…abcd to fund the Q3 grants program.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        function_signature: 'transfer(address,address,uint256)',
        decoded_function: 'transfer',
        decoded_arguments: {
          asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          to: '0x12340000000000000000000000000000000000ab',
          amount: '500000000000',
        },
      }),
    ],
    expected: {
      should_flag: false,
      notes: '500k USDC (6 decimals) to the stated multisig; matches.',
    },
  },
  {
    id: 'lido-upgrade-consistent',
    dao: 'lido',
    description:
      'Upgrade the withdrawal queue implementation to the new audited contract at 0xabcd…1234 to enable the v2 withdrawal flow.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x889edc2edab5f40e902b864ad4d7ade8e412f9b1',
        function_signature: 'upgradeTo(address)',
        decoded_function: 'upgradeTo',
        decoded_arguments: { newImplementation: '0xabcd000000000000000000000000000000001234' },
      }),
    ],
    expected: { should_flag: false, notes: 'Upgrade target matches the prose.' },
  },
  {
    id: 'compound-consistent-with-routine-emission',
    dao: 'compound',
    description:
      'Lower the collateral factor of the cETH market from 82.5% to 80% to reduce risk on volatile collateral.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
        function_signature: '_setCollateralFactor(address,uint256)',
        decoded_function: '_setCollateralFactor',
        decoded_arguments: {
          cToken: '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5',
          newCollateralFactorMantissa: '800000000000000000',
        },
      }),
      action({
        action_index: 1,
        target_address: '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5',
        function_signature: 'accrueInterest()',
        decoded_function: 'accrueInterest',
        decoded_arguments: {},
      }),
    ],
    expected: {
      should_flag: false,
      notes: 'accrueInterest is routine bookkeeping standard for this change; not a discrepancy.',
    },
  },
  {
    id: 'aave-param-change-consistent',
    dao: 'aave',
    description:
      'Increase the supply cap of the WETH reserve from 1,000,000 to 1,200,000 WETH to accommodate demand.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'setSupplyCap(address,uint256)',
        decoded_function: 'setSupplyCap',
        decoded_arguments: {
          asset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          newSupplyCap: '1200000',
        },
      }),
    ],
    expected: { should_flag: false, notes: 'Supply cap value matches the prose.' },
  },
  {
    id: 'lido-easytrack-motion-consistent',
    dao: 'lido',
    description:
      'Top up the reWARDS committee budget by 200,000 LDO for the next quarter via the Easy Track motion.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x85d703b2a4bad713b596c647badac9a1e95bb03d',
        function_signature: 'transfer(address,uint256)',
        decoded_function: 'transfer',
        decoded_arguments: {
          recipient: '0x87d93d9b2c672bf9c9642d853a8682546a5012b5',
          amount: '200000000000000000000000',
        },
      }),
    ],
    expected: { should_flag: false, notes: '200k LDO (18 decimals) matches the prose.' },
  },
  {
    id: 'compound-cancel-consistent',
    dao: 'compound',
    description:
      'Pause borrowing on the cWBTC2 market by setting the borrow guardian pause to true while the collateral migration is reviewed.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
        function_signature: '_setBorrowPaused(address,bool)',
        decoded_function: '_setBorrowPaused',
        decoded_arguments: {
          cToken: '0xccf4429db6322d5c611ee964527d42e5d685dd6a',
          state: true,
        },
      }),
    ],
    expected: { should_flag: false, notes: 'Borrow pause set true; matches the prose.' },
  },
  {
    id: 'aave-multi-action-consistent',
    dao: 'aave',
    description:
      'List the rETH reserve: set its LTV to 67% and its liquidation threshold to 74%, as specified in the risk parameters.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'configureReserveAsCollateral(address,uint256,uint256,uint256)',
        decoded_function: 'configureReserveAsCollateral',
        decoded_arguments: {
          asset: '0xae78736cd615f374d3085123a210448e74fc6393',
          ltv: '6700',
          liquidationThreshold: '7400',
          liquidationBonus: '10750',
        },
      }),
    ],
    expected: {
      should_flag: false,
      notes: 'LTV 6700 bps = 67%, threshold 7400 bps = 74%; matches.',
    },
  },

  // ── Seeded discrepancies (must flag) ───────────────────────────────────────
  {
    id: 'compound-value-mismatch-reserve',
    dao: 'compound',
    description:
      'Raise the reserve factor for the cUSDC market to 5% to modestly grow protocol reserves.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0xc3d688b66703497daa19211eedff47f25384cdc3',
        function_signature: '_setReserveFactor(uint256)',
        decoded_function: '_setReserveFactor',
        decoded_arguments: { newReserveFactorMantissa: '500000000000000000' },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['value_mismatch'],
      notes: 'Prose says 5% but calldata sets 5e17 = 50%.',
    },
  },
  {
    id: 'aave-target-mismatch-market',
    dao: 'aave',
    description:
      'Reduce the liquidation threshold of the USDC reserve from 85% to 80% to de-risk stablecoin exposure.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'setReserveLiquidationThreshold(address,uint256)',
        decoded_function: 'setReserveLiquidationThreshold',
        decoded_arguments: {
          asset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          liquidationThreshold: '8000',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['target_mismatch'],
      notes: 'Prose names USDC but the calldata asset 0x2260…c599 is WBTC.',
    },
  },
  {
    id: 'lido-omitted-transfer',
    dao: 'lido',
    description:
      'Upgrade the oracle report sanity checker to the new implementation to tighten report bounds.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x9305c1dbfe22c12c66339184c0025d7006f0f1cc',
        function_signature: 'upgradeTo(address)',
        decoded_function: 'upgradeTo',
        decoded_arguments: { newImplementation: '0x0000000000000000000000000000000000009999' },
      }),
      action({
        action_index: 1,
        target_address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
        function_signature: 'transfer(address,uint256)',
        decoded_function: 'transfer',
        decoded_arguments: {
          recipient: '0xdead00000000000000000000000000000000beef',
          amount: '1000000000000000000000000',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['omitted_in_description'],
      notes:
        'Calldata also transfers 1,000,000 LDO to an unmentioned address; prose only describes the upgrade.',
    },
  },
  {
    id: 'compound-extra-in-description',
    dao: 'compound',
    description:
      'Set the cDAI reserve factor to 15% and additionally distribute 10,000 COMP to the community treasury as a one-time reward.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
        function_signature: '_setReserveFactor(uint256)',
        decoded_function: '_setReserveFactor',
        decoded_arguments: { newReserveFactorMantissa: '150000000000000000' },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['extra_in_description'],
      notes: 'Prose claims a 10,000 COMP distribution that the calldata does not perform.',
    },
  },
  {
    id: 'aave-misleading-phrasing',
    dao: 'aave',
    description:
      'Make a small adjustment to the WETH reserve factor to better align with market conditions.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'setReserveFactor(address,uint256)',
        decoded_function: 'setReserveFactor',
        decoded_arguments: {
          asset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          newReserveFactor: '5000',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['misleading_phrasing'],
      notes:
        'Calldata sets the reserve factor to 50% (5000 bps) — a large change described as "small".',
    },
  },
  {
    id: 'compound-value-mismatch-decimals',
    dao: 'compound',
    description: 'Transfer 50,000 USDC from the Comptroller reserves to the audit vendor.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        function_signature: 'transfer(address,uint256)',
        decoded_function: 'transfer',
        decoded_arguments: {
          recipient: '0x1111111111111111111111111111111111111111',
          amount: '500000000000',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['value_mismatch'],
      notes: 'USDC has 6 decimals; 500000000000 = 500,000 USDC, not the 50,000 in the prose.',
    },
  },
  {
    id: 'lido-target-mismatch-recipient',
    dao: 'lido',
    description:
      'Fund the LEGO grants committee with 100,000 LDO by transferring to the committee multisig 0xaaaa…aaaa.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
        function_signature: 'transfer(address,uint256)',
        decoded_function: 'transfer',
        decoded_arguments: {
          recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          amount: '100000000000000000000000',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['target_mismatch'],
      notes: 'Prose says recipient 0xaaaa…aaaa; calldata sends to 0xbbbb…bbbb.',
    },
  },
  {
    id: 'aave-omitted-role-grant',
    dao: 'aave',
    description: 'Increase the isolation-mode debt ceiling of the ARB reserve to 12,000,000 USD.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'setDebtCeiling(address,uint256)',
        decoded_function: 'setDebtCeiling',
        decoded_arguments: {
          asset: '0x912ce59144191c1204e64559fe8253a0e49e6548',
          ceiling: '1200000000',
        },
      }),
      action({
        action_index: 1,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'grantRole(bytes32,address)',
        decoded_function: 'grantRole',
        decoded_arguments: {
          role: '0x0000000000000000000000000000000000000000000000000000000000000000',
          account: '0xcccccccccccccccccccccccccccccccccccccccc',
        },
      }),
    ],
    expected: {
      should_flag: true,
      seeded_discrepancy_types: ['omitted_in_description'],
      notes:
        'Calldata also grants DEFAULT_ADMIN_ROLE to an unmentioned account; prose only mentions the debt ceiling.',
    },
  },

  // ── Deliberately vague (low confidence — must NOT flag) ─────────────────────
  {
    id: 'compound-vague-description',
    dao: 'compound',
    description: 'Improve protocol parameters as discussed in the forum to keep markets healthy.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
        function_signature: '_setCollateralFactor(address,uint256)',
        decoded_function: '_setCollateralFactor',
        decoded_arguments: {
          cToken: '0x39aa39c021dfbae8fac545936693ac917d5e7563',
          newCollateralFactorMantissa: '750000000000000000',
        },
      }),
    ],
    expected: {
      should_flag: false,
      notes:
        'Description too vague to compare against the calldata → expect low confidence, no flag.',
    },
  },
  {
    id: 'aave-vague-description',
    dao: 'aave',
    description:
      'Routine maintenance update to reserve configuration per the risk team recommendation.',
    decoded_actions: [
      action({
        action_index: 0,
        target_address: '0x64b761d848206f447fe2dd461b0c635ec39ebb27',
        function_signature: 'setReserveFactor(address,uint256)',
        decoded_function: 'setReserveFactor',
        decoded_arguments: {
          asset: '0x6b175474e89094c44da98b954eedeac495271d0f',
          newReserveFactor: '2000',
        },
      }),
    ],
    expected: {
      should_flag: false,
      notes: 'No specific claim to contradict → expect low confidence, no flag.',
    },
  },
];
